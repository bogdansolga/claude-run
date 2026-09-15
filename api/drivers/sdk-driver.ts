import type {
  AgentDriver,
  AgentState,
  DriverEvent,
  DriverEventListener,
  DriverEventPayload,
} from "./agent-driver.js";

export interface SdkMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}

export interface SdkPermissionRequest {
  promptId: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  suggestions?: unknown[];
}

export interface SdkQueryRequest {
  prompt: string;
  options: Record<string, unknown>;
}

export type SdkQuery = (request: SdkQueryRequest) => AsyncIterable<SdkMessage>;

export interface SdkAgentDriverOptions {
  query: SdkQuery;
  model: string;
  maxBudgetUsd: number;
  spentUsd?: number;
  maxTurns?: number;
  maxThinkingTokens?: number;
  pathToClaudeCodeExecutable?: string;
}

export class SdkAgentDriver implements AgentDriver {
  private readonly listeners = new Map<DriverEvent, Set<DriverEventListener>>();
  private readonly options: SdkAgentDriverOptions;
  private abortController: AbortController | null = null;
  private repo = "";
  private resume: string | undefined;
  private sessionId = "sdk-session";
  private state: AgentState = "idle";
  private spentUsd: number;
  private pendingPermission: {
    request: SdkPermissionRequest;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(options: SdkAgentDriverOptions) {
    if (!options.model.trim()) throw new Error("SDK model is required");
    if (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd <= 0) throw new Error("SDK budget must be positive");
    this.options = options;
    this.spentUsd = options.spentUsd ?? 0;
  }

  async start(options: { repo: string; resume?: string; acceptEdits: boolean }): Promise<{ sessionId: string }> {
    this.repo = options.repo;
    this.resume = options.resume;
    if (options.resume) this.sessionId = options.resume;
    this.emit("session_id", { sessionId: this.sessionId });
    return { sessionId: this.sessionId };
  }

  async sendPrompt(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) throw new Error("SDK prompt is empty");
    if (this.state === "ended") throw new Error("SDK agent has ended");
    if (this.spentUsd >= this.options.maxBudgetUsd) throw new Error("SDK session budget exhausted");
    this.state = "thinking";
    this.abortController = new AbortController();
    const messages = this.options.query({
      prompt,
      options: {
        cwd: this.repo,
        model: this.options.model,
        maxBudgetUsd: Math.max(0, this.options.maxBudgetUsd - this.spentUsd),
        maxTurns: this.options.maxTurns ?? 1,
        maxThinkingTokens: this.options.maxThinkingTokens,
        resume: this.resume,
        abortController: this.abortController,
        pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable,
        settingSources: [],
        canUseTool: (toolName: string, input: Record<string, unknown>, details: {
          signal: AbortSignal;
          suggestions?: unknown[];
          title?: string;
          description?: string;
          toolUseID?: string;
        }) => this.requestPermission(toolName, input, details),
      },
    });
    let completed = false;
    for await (const message of messages) {
      this.consume(message);
      if (message.type === "result") completed = true;
    }
    if (!completed) {
      if (this.abortController?.signal.aborted) {
        this.state = "idle";
        return;
      }
      throw new Error("SDK turn ended without usage result");
    }
    this.state = "idle";
  }

  async resolvePermission(promptId: string, response: { allow: boolean; always?: boolean }): Promise<void> {
    const pending = this.pendingPermission;
    if (!pending || pending.request.promptId !== promptId) throw new Error("Unknown or resolved permission prompt");
    this.pendingPermission = null;
    this.state = "thinking";
    pending.resolve({
      behavior: response.allow ? "allow" : "deny",
      ...(response.allow ? {} : { message: "Permission denied by user" }),
      ...(response.always ? { updatedPermissions: [] } : {}),
      toolUseID: promptId,
    });
  }

  async answerQuestion(promptId: string, answer: string): Promise<void> {
    this.emit("question", { promptId, answer });
    this.state = "thinking";
  }

  async interrupt(): Promise<void> {
    this.pendingPermission?.reject(new Error("SDK permission interrupted"));
    this.pendingPermission = null;
    this.abortController?.abort();
    if (this.state !== "ended") this.state = "idle";
  }

  async kill(): Promise<void> {
    await this.interrupt();
    this.state = "ended";
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

  private consume(message: SdkMessage): void {
    if (message.session_id) {
      this.sessionId = message.session_id;
      this.resume = message.session_id;
      this.emit("session_id", { sessionId: message.session_id });
    }
    for (const block of message.message?.content ?? []) {
      if (block.type === "text" && block.text) this.emit("assistant_text", { delta: block.text });
    }
    if (message.type === "result") {
      const inputTokens = message.usage?.input_tokens;
      const outputTokens = message.usage?.output_tokens;
      const costUsd = message.total_cost_usd;
      if (
        typeof inputTokens !== "number" ||
        typeof outputTokens !== "number" ||
        typeof costUsd !== "number" ||
        !Number.isFinite(inputTokens) ||
        !Number.isFinite(outputTokens) ||
        !Number.isFinite(costUsd)
      ) throw new Error("SDK result omitted usage or cost");
      if (costUsd < 0 || this.spentUsd + costUsd > this.options.maxBudgetUsd) throw new Error("SDK turn exceeded budget");
      this.spentUsd += costUsd;
      this.emit("turn_complete", { usage: { inputTokens, outputTokens, costUsd, model: this.options.model } });
    }
  }

  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    details: { signal: AbortSignal; suggestions?: unknown[]; title?: string; description?: string; toolUseID?: string },
  ): Promise<unknown> {
    if (this.pendingPermission) return Promise.reject(new Error("SDK already has a pending permission prompt"));
    const promptId = details.toolUseID ?? `permission-${Date.now()}`;
    const request: SdkPermissionRequest = {
      promptId,
      toolName,
      input,
      title: details.title,
      description: details.description,
      suggestions: details.suggestions,
    };
    this.state = "awaiting_permission";
    return new Promise((resolve, reject) => {
      this.pendingPermission = { request, resolve, reject };
      const abort = () => {
        if (this.pendingPermission?.request.promptId !== promptId) return;
        this.pendingPermission = null;
        reject(new Error("SDK permission aborted"));
      };
      if (details.signal.aborted) abort();
      else details.signal.addEventListener("abort", abort, { once: true });
      this.emit("permission_request", request as unknown as DriverEventPayload);
    });
  }

  private emit(event: DriverEvent, payload: DriverEventPayload): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}
