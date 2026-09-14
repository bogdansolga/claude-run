import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserAudioEvent } from "../voice/audio-queue";

export interface AgentEventMessage {
  type: "agent_session" | "agent_event" | "audio" | "audio_error" | "error";
  data?: { seq?: number; type?: string; payload?: Record<string, unknown> } | BrowserAudioEvent;
  message?: string;
}

export function useAgentEvents(agentId: string | null) {
  const [events, setEvents] = useState<AgentEventMessage[]>([]);
  const [audioEvents, setAudioEvents] = useState<BrowserAudioEvent[]>([]);
  const sequenceRef = useRef(0);

  useEffect(() => {
    if (!agentId) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.port === "12000" ? `${window.location.hostname}:12001` : window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/api/agents/${agentId}?since=${sequenceRef.current}`);
    ws.onmessage = (message) => {
      const value = JSON.parse(message.data) as AgentEventMessage;
      setEvents((current) => [...current, value]);
      if (value.type === "agent_event" && value.data && "seq" in value.data && typeof value.data.seq === "number") {
        sequenceRef.current = Math.max(sequenceRef.current, value.data.seq);
      }
      if (value.type === "audio" && value.data && "sequence" in value.data) {
        setAudioEvents((current) => [...current, value.data as BrowserAudioEvent]);
      }
    };
    return () => ws.close();
  }, [agentId]);

  const clearAudio = useCallback(() => setAudioEvents([]), []);
  return { events, audioEvents, clearAudio };
}
