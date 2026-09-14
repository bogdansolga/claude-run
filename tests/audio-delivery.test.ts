import assert from "node:assert/strict";
import test from "node:test";

import { AudioDelivery } from "../api/voice/audio-delivery.js";
import { FakeTtsProvider } from "../api/voice/types.js";
import type { SpeechChunk } from "../api/speech-policy.js";

const chunks: SpeechChunk[] = [
  { id: "speech-1", sequence: 1, kind: "assistant", text: "First." },
  { id: "speech-2", sequence: 2, kind: "assistant", text: "Second." },
];

test("synthesizes ordered chunks and emits audio events", async () => {
  const delivery = new AudioDelivery(new FakeTtsProvider());
  const events: unknown[] = [];
  delivery.subscribe((event) => events.push(event));

  await delivery.enqueue(chunks);

  assert.deepEqual(events, [
    { type: "audio", clipId: "speech-1", sequence: 1, mimeType: "audio/wav", data: "FAKE_AUDIO" },
    { type: "audio", clipId: "speech-2", sequence: 2, mimeType: "audio/wav", data: "FAKE_AUDIO" },
  ]);
});

test("stop clears pending clips and repeat re-emits the last clip", async () => {
  const delivery = new AudioDelivery(new FakeTtsProvider({ delayMs: 10 }));
  const events: unknown[] = [];
  delivery.subscribe((event) => events.push(event));

  await delivery.enqueue([chunks[0]!]);
  delivery.enqueue([chunks[1]!]);
  delivery.stop();
  await delivery.repeat();

  assert.deepEqual(events, [
    { type: "audio", clipId: "speech-1", sequence: 1, mimeType: "audio/wav", data: "FAKE_AUDIO" },
    { type: "audio", clipId: "speech-1", sequence: 1, mimeType: "audio/wav", data: "FAKE_AUDIO" },
  ]);
});

test("TTS failure emits an error without removing text flow", async () => {
  const delivery = new AudioDelivery(new FakeTtsProvider({ fail: true }));
  const events: unknown[] = [];
  delivery.subscribe((event) => events.push(event));
  await delivery.enqueue([chunks[0]!]);

  assert.deepEqual(events, [{ type: "audio_error", clipId: "speech-1", message: "fake TTS failure" }]);
});
