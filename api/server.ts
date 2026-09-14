import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { ServerType } from "@hono/node-server";
import {
  initStorage,
  loadStorage,
  getClaudeDir,
  getSessions,
  getProjects,
  getConversation,
  getConversationStream,
  invalidateHistoryCache,
  addToFileIndex,
  deleteSession,
} from "./storage";
import {
  initWatcher,
  startWatcher,
  stopWatcher,
  onHistoryChange,
  offHistoryChange,
  onSessionChange,
  offSessionChange,
} from "./watcher";
import {
  createSession,
  getSession,
  getAllSessions as getAllTerminalSessions,
  killSession,
  addClient,
  removeClient,
  writeToSession,
  resizeSession,
  getSessionHistory,
  cleanupAllSessions,
} from "./pty-manager";
import {
  getHostsWithStatus,
  getDefaultHost,
} from "./hosts";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import open from "open";
import { logger } from "./utils/logger";
import { enqueueIngest } from "./jobs/queue";
import { getDatabase, getQueueRuntime } from "./instrumentation";
import { getCostSummary, getFileCostSummary } from "./cost-tracker";
import { AgentManager } from "./agent-manager";

const __filename = fileURLToPath(import.meta.url);

/**
 * Helper to extract error message from unknown error types
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * Extended WebSocket interface to store session ID and access raw socket
 * This avoids using 'as any' casts throughout the code
 */
interface ExtendedWSContext {
  raw: {
    readyState: number;
    send(data: string): void;
    close(): void;
  };
  sessionId?: string;
  agentUnsubscribe?: () => void;
  send(data: string): void;
  close(): void;
}
const __dirname = dirname(__filename);
const newSessionRequests = new Map<string, string>();

function getWebDistPath(): string {
  const prodPath = join(__dirname, "web");
  if (existsSync(prodPath)) {
    return prodPath;
  }
  return join(__dirname, "..", "dist", "web");
}

export interface ServerOptions {
  port: number;
  claudeDir?: string;
  dev?: boolean;
  open?: boolean;
}

export function createServer(options: ServerOptions) {
  const { port, claudeDir, dev = false, open: shouldOpen = true } = options;

  initStorage(claudeDir);
  initWatcher(getClaudeDir());

  const app = new Hono();
  const agentManager = new AgentManager();

  app.post("/api/agents", async (c) => {
    const body = await c.req.json<{ repo?: string; acceptEdits?: boolean; resume?: string }>();
    if (!body.repo || typeof body.repo !== "string") {
      return c.json({ error: "repo is required" }, 400);
    }
    try {
      const session = await agentManager.create({
        repo: body.repo,
        acceptEdits: body.acceptEdits === true,
        resume: body.resume,
      });
      return c.json(session, 201);
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 400);
    }
  });

  app.get("/api/agents", (c) => c.json(agentManager.list()));

  app.post("/api/agents/:id/prompt", async (c) => {
    try {
      const body = await c.req.json<{ text?: string }>();
      if (!body.text || typeof body.text !== "string") return c.json({ error: "text is required" }, 400);
      await agentManager.prompt(c.req.param("id"), body.text);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.post("/api/agents/:id/interrupt", async (c) => {
    try {
      await agentManager.interrupt(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  app.delete("/api/agents/:id", async (c) => {
    try {
      await agentManager.kill(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 404);
    }
  });

  // Create WebSocket helper
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/api/agents/:id",
    upgradeWebSocket((c) => {
      const agentId = c.req.param("id");
      const sinceParam = c.req.query("since");
      const parsedSince = sinceParam === undefined ? 0 : Number(sinceParam);
      const since = Number.isSafeInteger(parsedSince) && parsedSince >= 0 ? parsedSince : null;

      return {
        onOpen: (_event, ws) => {
          if (since === null) {
            ws.send(JSON.stringify({ type: "error", message: "since must be a non-negative integer" }));
            ws.close();
            return;
          }
          try {
            const id = agentId;
            if (!id) throw new Error("Agent ID required");
            const session = agentManager.getRequired(id);
            ws.send(JSON.stringify({ type: "agent_session", data: session }));
            const subscription = agentManager.getReplayAndSubscribe(id, since, (event) => {
              try {
                ws.send(JSON.stringify({ type: "agent_event", data: event }));
              } catch {
                subscription.unsubscribe();
              }
            });
            for (const event of subscription.replay) {
              ws.send(JSON.stringify({ type: "agent_event", data: event }));
            }
            (ws as unknown as ExtendedWSContext).agentUnsubscribe = subscription.unsubscribe;
          } catch (error) {
            ws.send(JSON.stringify({ type: "error", message: getErrorMessage(error) }));
            ws.close();
          }
        },
        onClose: (_event, ws) => {
          const unsubscribe = (ws as unknown as ExtendedWSContext).agentUnsubscribe;
          unsubscribe?.();
        },
      };
    }),
  );

  if (dev) {
    app.use(
      "*",
      cors({
        origin: ["http://localhost:12000"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      }),
    );
  }

  app.get("/api/sessions", async (c) => {
    const sessions = await getSessions();
    return c.json(sessions);
  });

  app.get("/api/projects", async (c) => {
    const projects = await getProjects();
    return c.json(projects);
  });

  app.get("/api/costs", async (c) => {
    const sessionId = c.req.query("sessionId");
    const database = getDatabase();
    if (database) {
      const summary = await getCostSummary(database.db, sessionId);
      const sessionFileSummary = await getFileCostSummary(sessionId);
      const dailyFileSummary = await getFileCostSummary();
      return c.json({
        ...summary,
        sessionCostUsd: sessionFileSummary.sessionCostUsd ?? summary.sessionCostUsd,
        todayCostUsd: dailyFileSummary.todayCostUsd ?? summary.todayCostUsd,
        todayInputTokens: Math.max(summary.todayInputTokens, dailyFileSummary.todayInputTokens),
        todayOutputTokens: Math.max(summary.todayOutputTokens, dailyFileSummary.todayOutputTokens),
        todayCacheReadTokens: Math.max(summary.todayCacheReadTokens, dailyFileSummary.todayCacheReadTokens),
        todayKnownTurns: Math.max(summary.todayKnownTurns, dailyFileSummary.todayKnownTurns),
        todayUnknownCostTurns: dailyFileSummary.todayUnknownCostTurns,
        costTracking: dailyFileSummary.costTracking === "unknown" ? summary.costTracking : dailyFileSummary.costTracking,
      });
    }
    return c.json(await getFileCostSummary(sessionId));
  });

  app.delete("/api/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");
    const success = await deleteSession(sessionId);
    if (success) {
      return c.json({ success: true });
    }
    return c.json({ error: "Failed to delete session" }, 500);
  });

  app.get("/api/sessions/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      let isConnected = true;
      const knownSessions = new Map<string, number>();

      const cleanup = () => {
        isConnected = false;
        offHistoryChange(handleHistoryChange);
      };

      const handleHistoryChange = async () => {
        if (!isConnected) {
          return;
        }
        try {
          const sessions = await getSessions();
          const newOrUpdated = sessions.filter((s) => {
            const known = knownSessions.get(s.id);
            return known === undefined || known !== s.timestamp;
          });

          for (const s of sessions) {
            knownSessions.set(s.id, s.timestamp);
          }

          if (newOrUpdated.length > 0) {
            await stream.writeSSE({
              event: "sessionsUpdate",
              data: JSON.stringify(newOrUpdated),
            });
          }
        } catch {
          cleanup();
        }
      };

      onHistoryChange(handleHistoryChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const sessions = await getSessions();
        for (const s of sessions) {
          knownSessions.set(s.id, s.timestamp);
        }

        await stream.writeSSE({
          event: "sessions",
          data: JSON.stringify(sessions),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  app.get("/api/conversation/:id", async (c) => {
    const sessionId = c.req.param("id");
    const messages = await getConversation(sessionId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/stream", async (c) => {
    const sessionId = c.req.param("id");
    const offsetParam = c.req.query("offset");
    let offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    return streamSSE(c, async (stream) => {
      let isConnected = true;

      const cleanup = () => {
        isConnected = false;
        offSessionChange(handleSessionChange);
      };

      const handleSessionChange = async (changedSessionId: string) => {
        if (changedSessionId !== sessionId || !isConnected) {
          return;
        }

        const { messages: newMessages, nextOffset: newOffset } =
          await getConversationStream(sessionId, offset);
        offset = newOffset;

        if (newMessages.length > 0) {
          try {
            await stream.writeSSE({
              event: "messages",
              data: JSON.stringify(newMessages),
            });
          } catch {
            cleanup();
          }
        }
      };

      onSessionChange(handleSessionChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const { messages, nextOffset } = await getConversationStream(
          sessionId,
          offset,
        );
        offset = nextOffset;

        await stream.writeSSE({
          event: "messages",
          data: JSON.stringify(messages),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  // Hosts API endpoint
  app.get("/api/hosts", async (c) => {
    const hosts = await getHostsWithStatus();
    const defaultHost = getDefaultHost();
    return c.json({
      hosts,
      defaultHostId: defaultHost.id,
    });
  });

  // Terminal API endpoints
  app.get("/api/terminals", (c) => {
    const terminals = getAllTerminalSessions().map((session) => ({
      id: session.id,
      repo: session.repo,
      host: session.host,
      hostLabel: session.hostLabel,
      createdAt: session.createdAt,
      clientCount: session.clients.size,
    }));
    return c.json(terminals);
  });

  app.delete("/api/terminals/:id", (c) => {
    const id = c.req.param("id");
    const killed = killSession(id);
    if (killed) {
      return c.json({ success: true });
    }
    return c.json({ error: "Session not found" }, 404);
  });

  // WebSocket endpoint for creating new terminal sessions
  app.get(
    "/api/terminals/new",
    upgradeWebSocket((c) => {
      const repo = c.req.query("repo");
      const hostId = c.req.query("host") || "local";
      const requestId = c.req.query("requestId");

      return {
        onOpen: (_event, ws) => {
          const extWs = ws as unknown as ExtendedWSContext;

          if (!repo) {
            ws.send(JSON.stringify({ type: "error", message: "repo parameter required" }));
            ws.close();
            return;
          }

          console.log(`[WS] Creating new session - repo: ${repo}, host: ${hostId}`);

          if (requestId) {
            const existingSessionId = newSessionRequests.get(requestId);
            if (existingSessionId) {
              const existingSession = getSession(existingSessionId);
              if (existingSession) {
                addClient(existingSession.id, extWs.raw);
                extWs.sessionId = existingSession.id;
                ws.send(JSON.stringify({ type: "session", id: existingSession.id, repo: existingSession.repo, host: existingSession.host, hostLabel: existingSession.hostLabel }));
                const history = getSessionHistory(existingSession.id);
                if (history) ws.send(JSON.stringify({ type: "data", data: history }));
                return;
              }
            }
          }

          // Create new session with specified host
          let session;
          try {
            session = createSession(repo, hostId);
          } catch (error) {
            const errorMsg = getErrorMessage(error);
            console.error(`[WS] Failed to create session:`, errorMsg);
            ws.send(JSON.stringify({ type: "error", message: `Failed to create session: ${errorMsg}` }));
            ws.close();
            return;
          }

          // Add this client to the session
          addClient(session.id, extWs.raw);

          // Send session info to client
          ws.send(
            JSON.stringify({
              type: "session",
              id: session.id,
              repo: session.repo,
              host: session.host,
              hostLabel: session.hostLabel,
            })
          );

          // Store session ID on the ws for later reference
          extWs.sessionId = session.id;
          if (requestId) newSessionRequests.set(requestId, session.id);
        },
        onMessage: (event, ws) => {
          const extWs = ws as unknown as ExtendedWSContext;
          const sessionId = extWs.sessionId;
          if (!sessionId) return;

          try {
            const msg = JSON.parse(event.data.toString());
            if (msg.type === "input") {
              writeToSession(sessionId, msg.data);
            } else if (msg.type === "resize") {
              resizeSession(sessionId, msg.cols, msg.rows);
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose: (_event, ws) => {
          const extWs = ws as unknown as ExtendedWSContext;
          const sessionId = extWs.sessionId;
          if (sessionId) {
            removeClient(sessionId, extWs.raw);
          }
        },
      };
    })
  );

  // WebSocket endpoint for connecting to existing terminal sessions
  app.get(
    "/api/terminals/:id",
    upgradeWebSocket((c) => {
      const sessionId = c.req.param("id");

      return {
        onOpen: (_event, ws) => {
          const extWs = ws as unknown as ExtendedWSContext;
          if (!sessionId) {
            ws.send(JSON.stringify({ type: "error", message: "Session ID required" }));
            ws.close();
            return;
          }
          const session = getSession(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
            ws.close();
            return;
          }

          // Add this client to the session
          addClient(session.id, extWs.raw);

          // Send session info
          ws.send(
            JSON.stringify({
              type: "session",
              id: session.id,
              repo: session.repo,
              host: session.host,
              hostLabel: session.hostLabel,
            })
          );

          // Send history if available
          const history = getSessionHistory(session.id);
          if (history) {
            ws.send(JSON.stringify({ type: "data", data: history }));
          }

          // Store session ID on the ws for later reference
          extWs.sessionId = sessionId;
        },
        onMessage: (event, ws) => {
          const extWs = ws as unknown as ExtendedWSContext;
          const sid = extWs.sessionId;
          if (!sid) return;

          try {
            const msg = JSON.parse(event.data.toString());
            if (msg.type === "input") {
              writeToSession(sid, msg.data);
            } else if (msg.type === "resize") {
              resizeSession(sid, msg.cols, msg.rows);
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose: (_event, ws) => {
          const extWs = ws as unknown as ExtendedWSContext;
          const sid = extWs.sessionId;
          if (sid) {
            removeClient(sid, extWs.raw);
          }
        },
      };
    })
  );

  const webDistPath = getWebDistPath();

  // Vite serves the frontend during development.
  if (!dev) {
    app.use("/*", serveStatic({ root: webDistPath }));
  }

  if (!dev) {
    app.get("/*", async (c) => {
      const indexPath = join(webDistPath, "index.html");
      try {
        const html = readFileSync(indexPath, "utf-8");
        return c.html(html);
      } catch {
        return c.text("UI not found. Run 'pnpm build' first.", 404);
      }
    });
  }

  onHistoryChange(() => {
    invalidateHistoryCache();
  });

  onSessionChange((sessionId: string, filePath: string) => {
    addToFileIndex(sessionId, filePath);
    const runtime = getQueueRuntime();
    if (runtime) {
      void enqueueIngest(runtime.boss, { filePath, sessionId });
    }
  });

  startWatcher();

  let httpServer: ServerType | null = null;

  return {
    app,
    port,
    start: async () => {
      await loadStorage();
      const openUrl = `http://localhost:${dev ? 12000 : port}/`;

      logger.info(`claude-run is running at ${openUrl}`);
      if (!dev && shouldOpen) {
        open(openUrl).catch((error) => logger.error("Failed to open browser", error));
      }

      httpServer = serve({
        fetch: app.fetch,
        port,
      });

      // Inject WebSocket handler
      injectWebSocket(httpServer);

      return httpServer;
    },
    stop: () => {
      stopWatcher();
      cleanupAllSessions();
      if (httpServer) {
        httpServer.close();
      }
    },
  };
}
