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

  constructor(options: { fail?: boolean } = {}) {
    this.shouldFail = options.fail === true;
  }

  async synthesize(chunk: SpeechChunk): Promise<TtsResult> {
    if (this.shouldFail) throw new Error("fake TTS failure");
    return { clipId: chunk.id, mimeType: "audio/wav", data: "FAKE_AUDIO" };
  }
}
