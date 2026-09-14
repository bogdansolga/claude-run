export type VoiceIntent =
  | { kind: "stop" }
  | { kind: "repeat" }
  | { kind: "new_session" }
  | { kind: "switch_session"; query: string }
  | { kind: "permission"; allow: boolean; always?: boolean }
  | { kind: "prompt"; text: string };

const normalize = (text: string) => text.trim().toLowerCase().replace(/[.!?]+$/g, "");

export function parseVoiceIntent(text: string): VoiceIntent {
  const normalized = normalize(text);
  if (normalized === "stop" || normalized === "stop speaking" || normalized === "cancel") return { kind: "stop" };
  if (normalized === "repeat" || normalized === "say that again") return { kind: "repeat" };
  if (normalized === "new session" || normalized === "start a new session") return { kind: "new_session" };
  if (normalized === "yes" || normalized === "allow") return { kind: "permission", allow: true };
  if (normalized === "always" || normalized === "always allow") return { kind: "permission", allow: true, always: true };
  if (normalized === "no" || normalized === "deny") return { kind: "permission", allow: false };
  const switchMatch = normalized.match(/^(?:switch to|open|select) session (.+)$/);
  if (switchMatch?.[1]) return { kind: "switch_session", query: switchMatch[1] };
  return { kind: "prompt", text: text.trim() };
}

export interface SessionCandidate { id: string; display: string; }

export function resolveSession(query: string, candidates: SessionCandidate[]):
  | { kind: "selected"; session: SessionCandidate }
  | { kind: "ambiguous"; matches: SessionCandidate[] }
  | { kind: "not_found" } {
  const normalized = query.trim().toLowerCase();
  const matches = candidates.filter((candidate) =>
    candidate.id.toLowerCase() === normalized || candidate.display.toLowerCase() === normalized ||
    candidate.display.toLowerCase().includes(normalized),
  );
  if (matches.length === 1) return { kind: "selected", session: matches[0]! };
  if (matches.length > 1) return { kind: "ambiguous", matches };
  return { kind: "not_found" };
}
