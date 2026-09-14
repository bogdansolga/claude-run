import type { SpeechChunk } from "../speech-policy.js";

export interface TtsResult {
  clipId: string;
  mimeType: string;
  data: string;
}

export interface TtsProvider {
  synthesize(chunk: SpeechChunk): Promise<TtsResult>;
}

export class FakeTtsProvider implements TtsProvider {
  private readonly shouldFail: boolean;
  private readonly delayMs: number;

  constructor(options: { fail?: boolean; delayMs?: number } = {}) {
    this.shouldFail = options.fail === true;
    this.delayMs = options.delayMs ?? 0;
  }

  async synthesize(chunk: SpeechChunk): Promise<TtsResult> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.shouldFail) throw new Error("fake TTS failure");
    return { clipId: chunk.id, mimeType: "audio/wav", data: "FAKE_AUDIO" };
  }
}
