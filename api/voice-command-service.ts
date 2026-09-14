import { parseVoiceIntent, resolveSession, type SessionCandidate, type VoiceIntent } from "./intent.js";
import type { AgentManager } from "./agent-manager.js";

export interface VoiceCommandResult {
  kind: VoiceIntent["kind"] | "clarification" | "not_found";
  message?: string;
  intent?: VoiceIntent;
  sessionId?: string;
}

export class VoiceCommandService {
  constructor(private readonly agents: AgentManager) {}

  async execute(agentId: string, transcript: string, sessions: SessionCandidate[] = []): Promise<VoiceCommandResult> {
    const intent = parseVoiceIntent(transcript);
    if (intent.kind === "stop") {
      this.agents.stopVoice(agentId);
      return { kind: "stop", intent };
    }
    if (intent.kind === "repeat") {
      await this.agents.repeatVoice(agentId);
      return { kind: "repeat", intent };
    }
    if (intent.kind === "permission") {
      return { kind: "permission", intent, message: "Permission response requires a pending permission prompt." };
    }
    if (intent.kind === "switch_session") {
      const resolved = resolveSession(intent.query, sessions);
      if (resolved.kind === "ambiguous") return { kind: "clarification", message: "More than one session matches; please say the exact session name." };
      if (resolved.kind === "not_found") return { kind: "not_found", message: "No matching session was found." };
      return { kind: "switch_session", intent, sessionId: resolved.session.id };
    }
    if (intent.kind === "new_session") return { kind: "new_session", intent };
    await this.agents.acceptTranscript(agentId, intent.text);
    return { kind: "prompt", intent };
  }
}
