import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AudioUploadService } from "../api/voice/audio-upload.js";
import { FakeSttProvider } from "../api/voice/stt.js";

test("validates, stores, and transcribes an audio upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "claude-run-audio-"));
  try {
    const service = new AudioUploadService(directory, new FakeSttProvider({ transcript: "hello agent" }));
    const result = await service.transcribe({ data: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" });
    assert.equal(result.transcript, "hello agent");
    assert.deepEqual(await readFile(join(directory, result.audioId)), Buffer.from([1, 2, 3]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects unsupported, empty, and oversized uploads", async () => {
  const service = new AudioUploadService("/tmp/unused", new FakeSttProvider());
  await assert.rejects(() => service.transcribe({ data: new Uint8Array([1]), mimeType: "text/plain" }), /Unsupported/);
  await assert.rejects(() => service.transcribe({ data: new Uint8Array(), mimeType: "audio/webm" }), /empty/);
  await assert.rejects(() => service.transcribe({ data: new Uint8Array(5 * 1024 * 1024 + 1), mimeType: "audio/webm" }), /too large/);
});

test("surfaces STT failures", async () => {
  const service = new AudioUploadService("/tmp/unused", new FakeSttProvider({ fail: true }));
  await assert.rejects(() => service.transcribe({ data: new Uint8Array([1]), mimeType: "audio/webm" }), /fake STT failure/);
});
