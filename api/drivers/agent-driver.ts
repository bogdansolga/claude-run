export type DriverEvent =
  | "session_id"
  | "assistant_text"
  | "transcript"
  | "tool_use"
  | "tool_result"
  | "permission_request"
  | "question"
  | "turn_complete"
  | "exit";

export type DriverEventPayload = Record<string, unknown>;
export type DriverEventListener = (
  payload: DriverEventPayload,
) => void;

export interface AgentDriver {
  start(options: {
    repo: string;
    resume?: string;
    acceptEdits: boolean;
  }): Promise<{ sessionId: string }>;
  sendPrompt(text: string): Promise<void>;
  resolvePermission(
    promptId: string,
    response: { allow: boolean; always?: boolean },
  ): Promise<void>;
  answerQuestion(promptId: string, answer: string): Promise<void>;
  interrupt(): Promise<void>;
  kill(): Promise<void>;
  on(event: DriverEvent, listener: DriverEventListener): () => void;
}

export type AgentState =
  | "idle"
  | "thinking"
  | "awaiting_permission"
  | "awaiting_answer"
  | "ended";

export function transitionAgentState(
  state: AgentState,
  event: "prompt" | "permission" | "question" | "resolved" | "complete" | "exit",
): AgentState {
  if (state === "ended") return "ended";
  if (event === "exit") return "ended";
  if (event === "prompt" && state === "idle") return "thinking";
  if (event === "permission" && state === "thinking") return "awaiting_permission";
  if (event === "question" && state === "thinking") return "awaiting_answer";
  if (event === "resolved" && (state === "awaiting_permission" || state === "awaiting_answer")) {
    return "thinking";
  }
  if (event === "complete" && state === "thinking") return "idle";
  throw new Error(`Invalid agent transition: ${state} + ${event}`);
}

export class FakeAgentDriver implements AgentDriver {
  private readonly listeners = new Map<DriverEvent, Set<DriverEventListener>>();
  readonly prompts: string[] = [];
  state: AgentState = "idle";
  private sessionId = "fake-session";

  async start(options: { repo: string; resume?: string; acceptEdits: boolean }): Promise<{ sessionId: string }> {
    this.sessionId = options.resume ?? "fake-session";
    this.emit("session_id", { sessionId: this.sessionId });
    return { sessionId: this.sessionId };
  }

  async sendPrompt(text: string): Promise<void> {
    this.state = transitionAgentState(this.state, "prompt");
    this.prompts.push(text);
  }

  async resolvePermission(promptId: string, response: { allow: boolean; always?: boolean }): Promise<void> {
    this.state = transitionAgentState(this.state, "resolved");
    this.emit("permission_request", { promptId, ...response });
  }

  async answerQuestion(promptId: string, answer: string): Promise<void> {
    this.state = transitionAgentState(this.state, "resolved");
    this.emit("question", { promptId, answer });
  }

  async interrupt(): Promise<void> {
    if (this.state === "thinking") this.state = "idle";
  }

  async kill(): Promise<void> {
    this.state = transitionAgentState(this.state, "exit");
    this.emit("exit", { code: 0 });
  }

  on(event: DriverEvent, listener: DriverEventListener): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }

  completeTurn(usage: DriverEventPayload = {}): void {
    this.state = transitionAgentState(this.state, "complete");
    this.emit("turn_complete", { usage });
  }

  private emit(event: DriverEvent, payload: DriverEventPayload): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}
