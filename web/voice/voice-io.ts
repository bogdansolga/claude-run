export type VoiceIoState = "idle" | "listening" | "uploading" | "transcribing" | "ready" | "error";

export interface VoiceIoCallbacks {
  onState?: (state: VoiceIoState) => void;
  onTranscript?: (transcript: string) => void;
  onError?: (message: string) => void;
}

export interface VoiceIo {
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
}

export class MediaRecorderVoiceIo implements VoiceIo {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(private readonly agentId: string, private readonly callbacks: VoiceIoCallbacks = {}) {}

  async start(): Promise<void> {
    if (this.recorder) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.start();
      this.callbacks.onState?.("listening");
    } catch (error) {
      this.callbacks.onState?.("error");
      this.callbacks.onError?.(error instanceof Error ? error.message : "Microphone unavailable");
    }
  }

  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    this.callbacks.onState?.("uploading");
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    recorder.stream.getTracks().forEach((track) => track.stop());
    this.recorder = null;
    const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
    if (blob.size === 0) {
      this.callbacks.onState?.("error");
      this.callbacks.onError?.("Recording was empty");
      return;
    }
    this.callbacks.onState?.("transcribing");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/audio`, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      const result = (await response.json()) as { transcript?: string; error?: string };
      if (!response.ok || !result.transcript) throw new Error(result.error ?? "Transcription failed");
      this.callbacks.onTranscript?.(result.transcript);
      this.callbacks.onState?.("ready");
      this.chunks = [];
    } catch (error) {
      this.callbacks.onState?.("error");
      this.callbacks.onError?.(error instanceof Error ? error.message : "Transcription failed");
    }
  }

  cancel(): void {
    if (!this.recorder) return;
    this.recorder.onstop = null;
    this.recorder.stop();
    this.recorder.stream.getTracks().forEach((track) => track.stop());
    this.recorder = null;
    this.chunks = [];
    this.callbacks.onState?.("idle");
  }
}
