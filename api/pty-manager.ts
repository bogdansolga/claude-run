import { spawn, type IPty } from "node-pty";
import { platform } from "os";

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
  host: string; // "local" for now
  createdAt: number;
  clients: Set<WebSocketLike>;
  history: string; // Buffer of PTY output for new clients
}

const sessions = new Map<string, TerminalSession>();

// Maximum history buffer size (100KB)
const MAX_HISTORY_SIZE = 100 * 1024;

/**
 * Create a new terminal session running claude in the specified repo directory
 */
export function createSession(repo: string): TerminalSession {
  const id = crypto.randomUUID();
  const shell = platform() === "win32" ? "cmd.exe" : "claude";

  const pty = spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: repo,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  });

  const session: TerminalSession = {
    id,
    pty,
    repo,
    host: "local",
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
