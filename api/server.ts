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
  type HostInfo,
} from "./hosts";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import open from "open";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  // Create WebSocket helper
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

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

      return {
        onOpen: (_event, ws) => {
          if (!repo) {
            ws.send(JSON.stringify({ type: "error", message: "repo parameter required" }));
            ws.close();
            return;
          }

          console.log(`[WS] Creating new session - repo: ${repo}, host: ${hostId}`);

          // Create new session with specified host
          let session;
          try {
            session = createSession(repo, hostId);
          } catch (error) {
            console.error(`[WS] Failed to create session:`, error);
            ws.send(JSON.stringify({ type: "error", message: `Failed to create session: ${error}` }));
            ws.close();
            return;
          }

          // Add this client to the session
          const rawWs = (ws as any).raw;
          addClient(session.id, rawWs);

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
          (ws as any).sessionId = session.id;
        },
        onMessage: (event, ws) => {
          const sessionId = (ws as any).sessionId;
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
          const sessionId = (ws as any).sessionId;
          if (sessionId) {
            const rawWs = (ws as any).raw;
            removeClient(sessionId, rawWs);
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
          const session = getSession(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
            ws.close();
            return;
          }

          // Add this client to the session
          const rawWs = (ws as any).raw;
          addClient(sessionId, rawWs);

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
          const history = getSessionHistory(sessionId);
          if (history) {
            ws.send(JSON.stringify({ type: "data", data: history }));
          }

          // Store session ID on the ws for later reference
          (ws as any).sessionId = sessionId;
        },
        onMessage: (event, ws) => {
          const sid = (ws as any).sessionId;
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
          const sid = (ws as any).sessionId;
          if (sid) {
            const rawWs = (ws as any).raw;
            removeClient(sid, rawWs);
          }
        },
      };
    })
  );

  const webDistPath = getWebDistPath();

  app.use("/*", serveStatic({ root: webDistPath }));

  app.get("/*", async (c) => {
    const indexPath = join(webDistPath, "index.html");
    try {
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("UI not found. Run 'pnpm build' first.", 404);
    }
  });

  onHistoryChange(() => {
    invalidateHistoryCache();
  });

  onSessionChange((sessionId: string, filePath: string) => {
    addToFileIndex(sessionId, filePath);
  });

  startWatcher();

  let httpServer: ServerType | null = null;

  return {
    app,
    port,
    start: async () => {
      await loadStorage();
      const openUrl = `http://localhost:${dev ? 12000 : port}/`;

      console.log(`\n  claude-run is running at ${openUrl}\n`);
      if (!dev && shouldOpen) {
        open(openUrl).catch(console.error);
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
