import {
  type AgentDriver,
  type AgentState,
  type DriverEvent,
  type DriverEventPayload,
  FakeAgentDriver,
} from "./drivers/agent-driver.js";
import { SpeechPolicy, type SpeechMode } from "./speech-policy.js";
import { AudioDelivery, type AudioEvent, type AudioListener } from "./voice/audio-delivery.js";
import { FakeTtsProvider, type TtsProvider } from "./voice/types.js";

export interface AgentSession {
  id: string;
  repo: string;
  acceptEdits: boolean;
  state: AgentState;
  claudeSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEventRecord {
  seq: number;
  type: DriverEvent;
  payload: DriverEventPayload;
  createdAt: string;
}

export interface CreateAgentOptions {
  repo: string;
  acceptEdits: boolean;
  resume?: string;
}

type DriverFactory = () => AgentDriver;
type AgentListener = (event: AgentEventRecord) => void;

export interface AgentManagerOptions {
  tts?: TtsProvider;
  speechMode?: SpeechMode;
}

interface ManagedAgent {
  session: AgentSession;
  driver: AgentDriver;
  events: AgentEventRecord[];
  listeners: Set<AgentListener>;
  audioListeners: Set<AudioListener>;
  speech: SpeechPolicy;
  audio: AudioDelivery;
  nextSequence: number;
  cleanup: Array<() => void>;
}

export class AgentManager {
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly createDriver: DriverFactory;
  private readonly options: Required<AgentManagerOptions>;
  private nextId = 1;

  constructor(
    createDriver: DriverFactory = () => new FakeAgentDriver(),
    options: AgentManagerOptions = {},
  ) {
    this.options = {
      tts: options.tts ?? new FakeTtsProvider(),
      speechMode: options.speechMode ?? "verbatim",
    };

    this.createDriver = createDriver;
  }

  async create(options: CreateAgentOptions): Promise<AgentSession> {
    const id = `agent-${this.nextId++}`;
    const now = new Date().toISOString();
    const driver = this.createDriver();
    const managed: ManagedAgent = {
      session: {
        id,
        repo: options.repo,
        acceptEdits: options.acceptEdits,
        state: "idle",
        claudeSessionId: null,
        createdAt: now,
        updatedAt: now,
      },
      driver,
      events: [],
      listeners: new Set(),
      audioListeners: new Set(),
      speech: new SpeechPolicy(this.options.speechMode),
      audio: new AudioDelivery(this.options.tts),
      nextSequence: 1,
      cleanup: [],
    };

    managed.audio.subscribe((audioEvent) => {
      for (const listener of managed.audioListeners) listener(audioEvent);
    });

    for (const type of [
      "session_id",
      "assistant_text",
      "tool_use",
      "tool_result",
      "permission_request",
      "question",
      "turn_complete",
      "exit",
    ] as DriverEvent[]) {
      managed.cleanup.push(
        driver.on(type, (payload) => this.recordDriverEvent(managed, type, payload)),
      );
    }

    this.agents.set(id, managed);
    try {
      const result = await driver.start({
        repo: options.repo,
        resume: options.resume,
        acceptEdits: options.acceptEdits,
      });
      managed.session.claudeSessionId = result.sessionId;
      managed.session.updatedAt = new Date().toISOString();
      return { ...managed.session };
    } catch (error) {
      this.remove(id);
      throw error;
    }
  }

  list(): AgentSession[] {
    return [...this.agents.values()].map(({ session }) => ({ ...session }));
  }

  get(id: string): AgentSession | undefined {
    const managed = this.agents.get(id);
    return managed ? { ...managed.session } : undefined;
  }

  getRequired(id: string): AgentSession {
    const session = this.get(id);
    if (!session) throw new Error(`Unknown agent: ${id}`);
    return session;
  }

  events(id: string, since = 0): AgentEventRecord[] {
    return this.getRequiredManaged(id).events.filter((event) => event.seq > since);
  }

  recordEventForTest(id: string, type: DriverEvent, payload: DriverEventPayload = {}): void {
    this.recordDriverEvent(this.getRequiredManaged(id), type, payload);
  }

  getReplayAndSubscribe(id: string, since: number, listener: AgentListener): {
    replay: AgentEventRecord[];
    unsubscribe: () => void;
  } {
    const managed = this.getRequiredManaged(id);
    const replay = managed.events.filter((event) => event.seq > since);
    managed.listeners.add(listener);
    return {
      replay,
      unsubscribe: () => managed.listeners.delete(listener),
    };
  }

  subscribe(id: string, listener: AgentListener): () => void {
    const managed = this.getRequiredManaged(id);
    managed.listeners.add(listener);
    return () => managed.listeners.delete(listener);
  }

  subscribeAudio(id: string, listener: AudioListener): () => void {
    const managed = this.getRequiredManaged(id);
    managed.audioListeners.add(listener);
    return () => managed.audioListeners.delete(listener);
  }

  async flushVoice(id: string): Promise<void> {
    const managed = this.getRequiredManaged(id);
    const chunks = managed.speech.consume({ type: "turn_complete", payload: {} });
    await managed.audio.enqueue(chunks);
  }

  stopVoice(id: string): void {
    this.getRequiredManaged(id).audio.stop();
  }

  async repeatVoice(id: string): Promise<void> {
    await this.getRequiredManaged(id).audio.repeat();
  }

  async acceptTranscript(id: string, transcript: string): Promise<void> {
    const text = transcript.trim();
    if (!text) throw new Error("Transcript is empty");
    const managed = this.getRequiredManaged(id);
    this.recordDriverEvent(managed, "transcript", {
      text,
      source: "voice_input",
    });
    await managed.driver.sendPrompt(text);
    managed.session.state = "thinking";
    managed.session.updatedAt = new Date().toISOString();
  }

  async prompt(id: string, text: string): Promise<void> {
    const managed = this.getRequiredManaged(id);
    if (managed.session.state === "ended") throw new Error(`Agent ${id} has ended`);
    await managed.driver.sendPrompt(text);
    managed.session.state = "thinking";
    managed.session.updatedAt = new Date().toISOString();
  }

  async interrupt(id: string): Promise<void> {
    const managed = this.getRequiredManaged(id);
    await managed.driver.interrupt();
    if (managed.session.state !== "ended") managed.session.state = "idle";
    managed.session.updatedAt = new Date().toISOString();
  }

  async kill(id: string): Promise<void> {
    const managed = this.getRequiredManaged(id);
    if (managed.session.state === "ended") return;
    await managed.driver.kill();
    managed.session.state = "ended";
    managed.session.updatedAt = new Date().toISOString();
  }

  remove(id: string): void {
    const managed = this.agents.get(id);
    if (!managed) return;
    for (const cleanup of managed.cleanup) cleanup();
    this.agents.delete(id);
  }

  private getRequiredManaged(id: string): ManagedAgent {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`Unknown agent: ${id}`);
    return managed;
  }

  private recordDriverEvent(
    managed: ManagedAgent,
    type: DriverEvent,
    payload: DriverEventPayload,
  ): void {
    if (type === "session_id" && typeof payload.sessionId === "string") {
      managed.session.claudeSessionId = payload.sessionId;
    }
    if (type === "permission_request") managed.session.state = "awaiting_permission";
    if (type === "question") managed.session.state = "awaiting_answer";
    if (type === "turn_complete" && managed.session.state === "thinking") {
      managed.session.state = "idle";
    }
    if (type === "exit") managed.session.state = "ended";
    managed.session.updatedAt = new Date().toISOString();
    const event: AgentEventRecord = {
      seq: managed.nextSequence++,
      type,
      payload: { ...payload },
      createdAt: managed.session.updatedAt,
    };
    managed.events.push(event);
    for (const listener of managed.listeners) listener(event);

    const speechChunks = managed.speech.consume(event);
    if (speechChunks.length > 0) {
      void managed.audio.enqueue(speechChunks);
    }
  }
}
