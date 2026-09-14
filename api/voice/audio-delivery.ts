import type { SpeechChunk } from "../speech-policy.js";
import type { TtsProvider, TtsResult } from "./types.js";

export type AudioEvent =
  | { type: "audio"; clipId: string; sequence: number; mimeType: string; data: string }
  | { type: "audio_error"; clipId: string; message: string };

export type AudioListener = (event: AudioEvent) => void;

export class AudioDelivery {
  private readonly tts: TtsProvider;
  private readonly listeners = new Set<AudioListener>();
  private queue: SpeechChunk[] = [];
  private processing = false;
  private stopped = false;
  private lastResult: { chunk: SpeechChunk; result: TtsResult } | null = null;

  constructor(tts: TtsProvider) {
    this.tts = tts;
  }

  subscribe(listener: AudioListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async enqueue(chunks: SpeechChunk[]): Promise<void> {
    this.queue.push(...chunks);
    if (!this.stopped) await this.process();
  }

  resume(): void {
    this.stopped = false;
    void this.process();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  async repeat(): Promise<void> {
    if (!this.lastResult) return;
    this.stopped = false;
    this.emit({
      type: "audio",
      clipId: this.lastResult.result.clipId,
      sequence: this.lastResult.chunk.sequence,
      mimeType: this.lastResult.result.mimeType,
      data: this.lastResult.result.data,
    });
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const chunk = this.queue.shift()!;
        try {
          const result = await this.tts.synthesize(chunk);
          if (this.stopped) break;
          this.lastResult = { chunk, result };
          this.emit({
            type: "audio",
            clipId: result.clipId,
            sequence: chunk.sequence,
            mimeType: result.mimeType,
            data: result.data,
          });
        } catch (error) {
          this.emit({
            type: "audio_error",
            clipId: chunk.id,
            message: error instanceof Error ? error.message : "TTS failed",
          });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private emit(event: AudioEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
