import { useEffect, useRef, useCallback, useState } from "react";

export interface TerminalMessage {
  type: "session" | "data" | "exit" | "error" | "killed";
  id?: string;
  repo?: string;
  host?: string;
  data?: string;
  exitCode?: number;
  signal?: number;
  message?: string;
}

interface UseTerminalOptions {
  onData?: (data: string) => void;
  onSessionInfo?: (info: { id: string; repo: string; host: string }) => void;
  onExit?: (exitCode: number, signal?: number) => void;
  onError?: (message: string) => void;
  maxRetries?: number;
  baseDelay?: number;
}

export function useTerminal(url: string | null, options: UseTerminalOptions = {}) {
  const {
    onData,
    onSessionInfo,
    onExit,
    onError,
    maxRetries = 5,
    baseDelay = 1000,
  } = options;

  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // Keep callbacks in refs to avoid reconnecting on callback changes
  const onDataRef = useRef(onData);
  const onSessionInfoRef = useRef(onSessionInfo);
  const onExitRef = useRef(onExit);
  const onErrorRef = useRef(onError);

  onDataRef.current = onData;
  onSessionInfoRef.current = onSessionInfo;
  onExitRef.current = onExit;
  onErrorRef.current = onError;

  const connect = useCallback(() => {
    if (!mountedRef.current || !url) {
      return;
    }

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    // Build WebSocket URL
    const wsUrl = url.startsWith("ws")
      ? url
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${url}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      retryCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;

      try {
        const msg: TerminalMessage = JSON.parse(event.data);

        switch (msg.type) {
          case "session":
            if (msg.id && msg.repo && msg.host) {
              setSessionId(msg.id);
              onSessionInfoRef.current?.({ id: msg.id, repo: msg.repo, host: msg.host });
            }
            break;
          case "data":
            if (msg.data) {
              onDataRef.current?.(msg.data);
            }
            break;
          case "exit":
            onExitRef.current?.(msg.exitCode ?? 0, msg.signal);
            break;
          case "error":
            onErrorRef.current?.(msg.message ?? "Unknown error");
            break;
          case "killed":
            onErrorRef.current?.("Session was terminated");
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);

      // Attempt reconnection with exponential backoff
      if (retryCountRef.current < maxRetries) {
        const delay = Math.min(
          baseDelay * Math.pow(2, retryCountRef.current),
          30000
        );
        retryCountRef.current++;

        retryTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        onErrorRef.current?.("Connection lost after maximum retries");
      }
    };

    ws.onerror = () => {
      // Error handling is done in onclose
    };
  }, [url, maxRetries, baseDelay]);

  // Send data to the terminal
  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  // Send resize event
  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  // Disconnect from terminal
  const disconnect = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    retryCountRef.current = maxRetries; // Prevent reconnection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setSessionId(null);
  }, [maxRetries]);

  // Connect when URL changes
  useEffect(() => {
    mountedRef.current = true;

    if (url) {
      connect();
    }

    return () => {
      mountedRef.current = false;

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, url]);

  return {
    connected,
    sessionId,
    send,
    resize,
    disconnect,
  };
}
