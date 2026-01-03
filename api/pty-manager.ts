import { spawn, type IPty } from "node-pty";
import { platform } from "os";
import { getHost, type HostConfig } from "./hosts";

/**
 * Validate that a path is safe to use in shell commands
 * Only allows alphanumeric, dash, underscore, dot, forward slash
 * Rejects path traversal attempts (..)
 */
function isValidPath(path: string): boolean {
  return /^[a-zA-Z0-9_\-./]+$/.test(path) && !path.includes("..");
}

// Use a generic WebSocket interface to avoid ws type dependency
interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
}

export interface TerminalSession {
  id: string;
  pty: IPty;
  repo: string;
  host: string; // host ID (e.g., "local", "macstudio")
  hostLabel: string; // human-readable host label
  createdAt: number;
  clients: Set<WebSocketLike>;
  history: string; // Buffer of PTY output for new clients
}

const sessions = new Map<string, TerminalSession>();

// Maximum history buffer size (100KB)
const MAX_HISTORY_SIZE = 100 * 1024;

/**
 * Create a new terminal session running claude in the specified repo directory
 * @param repo - The repository path where claude should run
 * @param hostId - The host ID to run on (defaults to "local")
 */
export function createSession(repo: string, hostId: string = "local"): TerminalSession {
  const id = crypto.randomUUID();

  // Validate repository path to prevent command injection
  if (!isValidPath(repo)) {
    throw new Error("Invalid repository path");
  }

  let pty: IPty;
  let hostLabel = "Local";

  if (hostId !== "local") {
    const host = getHost(hostId);
    if (!host) {
      throw new Error(`Unknown host: ${hostId}`);
    }

    if (host.type === "ssh" && host.host && host.user) {
      // SSH connection: spawn ssh with claude command
      pty = spawn("ssh", ["-t", `${host.user}@${host.host}`, `cd ${repo} && claude`], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      });
      hostLabel = host.label;
    } else {
      throw new Error(`Invalid host configuration for: ${hostId}`);
    }
  } else {
    // Local execution
    const host = getHost(hostId);
    const shell = platform() === "win32" ? "cmd.exe" : "claude";
    pty = spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: repo,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    });
    hostLabel = host?.label || "Local";
  }

  const session: TerminalSession = {
    id,
    pty,
    repo,
    host: hostId,
    hostLabel,
    createdAt: Date.now(),
    clients: new Set(),
    history: "",
  };

  // Handle PTY data output
  pty.onData((data: string) => {
    // Append to history buffer
    session.history += data;
    if (session.history.length > MAX_HISTORY_SIZE) {
      session.history = session.history.slice(-MAX_HISTORY_SIZE);
    }

    // Broadcast to all connected clients
    for (const client of session.clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(
          JSON.stringify({
            type: "data",
            data,
          })
        );
      }
    }
  });

  // Handle PTY exit
  pty.onExit(({ exitCode, signal }) => {
    // Notify clients of session end
    for (const client of session.clients) {
      if (client.readyState === 1) {
        client.send(
          JSON.stringify({
            type: "exit",
            exitCode,
            signal,
          })
        );
      }
    }
    sessions.delete(id);
  });

  sessions.set(id, session);
  return session;
}

/**
 * Get a session by ID
 */
export function getSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

/**
 * Get all active sessions
 */
export function getAllSessions(): TerminalSession[] {
  return Array.from(sessions.values());
}

/**
 * Kill a session and cleanup
 */
export function killSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) {
    return false;
  }

  // Close all connected clients
  for (const client of session.clients) {
    if (client.readyState === 1) {
      client.send(
        JSON.stringify({
          type: "killed",
        })
      );
      client.close();
    }
  }

  // Kill the PTY process
  session.pty.kill();
  sessions.delete(id);
  return true;
}

/**
 * Add a WebSocket client to a session
 */
export function addClient(sessionId: string, ws: WebSocketLike): boolean {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.clients.add(ws);
  return true;
}

/**
 * Remove a WebSocket client from a session
 */
export function removeClient(sessionId: string, ws: WebSocketLike): boolean {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.clients.delete(ws);
  return true;
}

/**
 * Write data to a session's PTY stdin
 */
export function writeToSession(sessionId: string, data: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.pty.write(data);
  return true;
}

/**
 * Resize a session's PTY
 */
export function resizeSession(
  sessionId: string,
  cols: number,
  rows: number
): boolean {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.pty.resize(cols, rows);
  return true;
}

/**
 * Get session history for new clients
 */
export function getSessionHistory(sessionId: string): string | undefined {
  const session = sessions.get(sessionId);
  return session?.history;
}

/**
 * Cleanup all sessions (for server shutdown)
 */
export function cleanupAllSessions(): void {
  for (const [id] of sessions) {
    killSession(id);
  }
}
