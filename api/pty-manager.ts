import { spawn, type IPty } from "node-pty";
import { platform, homedir } from "os";
import { existsSync } from "fs";
import { join } from "path";
import { getHost, type HostConfig } from "./hosts";

/**
 * Find the claude executable path
 * Checks common locations since ~/.local/bin may not be in PATH
 */
function findClaudeExecutable(): string {
  const possiblePaths = [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "claude", // fallback to PATH
  ];

  for (const path of possiblePaths) {
    if (path === "claude" || existsSync(path)) {
      return path;
    }
  }

  return "claude";
}

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

// Session inactivity timeout (configured via environment variable, default: disabled)
// Set CLAUDE_RUN_SESSION_TIMEOUT_MS to enable (e.g., 1800000 for 30 minutes)
const SESSION_TIMEOUT_MS = process.env.CLAUDE_RUN_SESSION_TIMEOUT_MS
  ? parseInt(process.env.CLAUDE_RUN_SESSION_TIMEOUT_MS, 10)
  : 0;

// Track last activity time and timeout handles for each session
const sessionTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Reset the inactivity timeout for a session
 */
function resetSessionTimeout(sessionId: string): void {
  if (SESSION_TIMEOUT_MS <= 0) return;

  // Clear existing timeout
  const existingTimeout = sessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Set new timeout
  const timeout = setTimeout(() => {
    const session = sessions.get(sessionId);
    if (session && session.clients.size === 0) {
      console.log(`Session ${sessionId} timed out due to inactivity`);
      killSession(sessionId);
    } else {
      // Still has clients, reset the timeout
      resetSessionTimeout(sessionId);
    }
  }, SESSION_TIMEOUT_MS);

  sessionTimeouts.set(sessionId, timeout);
}

/**
 * Clear the timeout for a session
 */
function clearSessionTimeout(sessionId: string): void {
  const timeout = sessionTimeouts.get(sessionId);
  if (timeout) {
    clearTimeout(timeout);
    sessionTimeouts.delete(sessionId);
  }
}

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
    const claudePath = findClaudeExecutable();
    const shell = platform() === "win32" ? "cmd.exe" : process.env.SHELL || "/bin/zsh";
    console.log(`[PTY] Spawning shell: ${shell} with claude: ${claudePath} in directory: ${repo}`);

    // Spawn a shell and run claude inside it
    // This is more reliable than spawning claude directly
    pty = spawn(shell, ["-c", claudePath], {
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
    // Clear any pending timeout
    clearSessionTimeout(id);

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

  // Start inactivity timeout (will be reset when clients connect)
  resetSessionTimeout(id);

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

  // Clear any pending timeout
  clearSessionTimeout(id);

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

  // Clear timeout since we have an active client
  clearSessionTimeout(sessionId);

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

  // If no more clients, start inactivity timeout
  if (session.clients.size === 0) {
    resetSessionTimeout(sessionId);
  }

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
  // Clear all timeouts
  for (const timeout of sessionTimeouts.values()) {
    clearTimeout(timeout);
  }
  sessionTimeouts.clear();

  // Kill all sessions
  for (const [id] of sessions) {
    killSession(id);
  }
}
