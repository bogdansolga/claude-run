import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useTerminal } from "../hooks/use-terminal";

interface TerminalPanelProps {
  /** Session ID to connect to an existing session */
  sessionId?: string;
  /** Repository path for creating a new session */
  repo?: string;
  /** Host ID for creating a new session (default: "local") */
  host?: string;
  /** Callback when session info is received */
  onSessionInfo?: (info: { id: string; repo: string; host: string; hostLabel?: string }) => void;
  /** Callback when terminal exits */
  onExit?: (exitCode: number, signal?: number) => void;
  /** Callback when an error occurs */
  onError?: (message: string) => void;
  /** Additional CSS class names */
  className?: string;
}

export function TerminalPanel({
  sessionId,
  repo,
  host,
  onSessionInfo,
  onExit,
  onError,
  className = "",
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Determine WebSocket URL based on props
  const wsUrl = sessionId
    ? `/api/terminals/${sessionId}`
    : repo
      ? `/api/terminals/new?repo=${encodeURIComponent(repo)}${host ? `&host=${encodeURIComponent(host)}` : ""}`
      : null;

  // Handle data from PTY
  const handleData = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  const { connected, send, resize } = useTerminal(wsUrl, {
    onData: handleData,
    onSessionInfo,
    onExit,
    onError,
  });

  // Initialize xterm.js
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: "#09090b", // zinc-950
        foreground: "#fafafa", // zinc-50
        cursor: "#fafafa",
        cursorAccent: "#09090b",
        selectionBackground: "#3f3f46", // zinc-700
        black: "#09090b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#fafafa",
        brightBlack: "#71717a",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle terminal input
    terminal.onData((data) => {
      send(data);
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      resize(terminal.cols, terminal.rows);
    };

    // Use ResizeObserver for container resize
    const resizeObserver = new ResizeObserver(() => {
      // Debounce resize to avoid excessive calls
      requestAnimationFrame(() => {
        handleResize();
      });
    });

    resizeObserver.observe(containerRef.current);

    // Also handle window resize
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [send, resize]);

  // Send initial resize when connected
  useEffect(() => {
    if (connected && terminalRef.current && fitAddonRef.current) {
      fitAddonRef.current.fit();
      resize(terminalRef.current.cols, terminalRef.current.rows);
    }
  }, [connected, resize]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full bg-zinc-950 ${className}`}
      style={{ padding: "4px" }}
    />
  );
}

export default TerminalPanel;
