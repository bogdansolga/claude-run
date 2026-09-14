import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SttProvider } from "./stt.js";

export const AUDIO_MAX_BYTES = 5 * 1024 * 1024;
const AUDIO_MIME_TYPES = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg"]);

export interface AudioUpload {
  data: Uint8Array;
  mimeType: string;
}

export interface TranscriptResult {
  audioId: string;
  transcript: string;
}

export class AudioUploadService {
  constructor(
    private readonly directory: string,
    private readonly stt: SttProvider,
  ) {}

  async transcribe(upload: AudioUpload): Promise<TranscriptResult> {
    if (!AUDIO_MIME_TYPES.has(upload.mimeType)) {
      throw new Error("Unsupported audio MIME type");
    }
    if (upload.data.byteLength === 0) throw new Error("Audio upload is empty");
    if (upload.data.byteLength > AUDIO_MAX_BYTES) throw new Error("Audio upload is too large");
    const audioId = randomUUID();
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, audioId), upload.data);
    const transcript = (await this.stt.transcribe(upload)).trim();
    if (!transcript) throw new Error("Audio transcript is empty");
    return { audioId, transcript };
  }
}
