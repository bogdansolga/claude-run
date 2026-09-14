import assert from "node:assert/strict";
import test from "node:test";

import {
  SpeechPolicy,
  type SpeechChunk,
  type SpeechMode,
} from "../api/speech-policy.js";
import { FakeTtsProvider, type TtsProvider } from "../api/voice/types.js";

test("verbatim mode chunks assistant sentences in order", () => {
  const policy = new SpeechPolicy("verbatim");

  assert.deepEqual(policy.consume({ type: "assistant_text", payload: { delta: "First sentence. Second sentence!" } }), [
    { id: "speech-1", sequence: 1, kind: "assistant", text: "First sentence." },
    { id: "speech-2", sequence: 2, kind: "assistant", text: "Second sentence!" },
  ] satisfies SpeechChunk[]);
});

test("verbatim mode describes code blocks instead of reading them", () => {
  const policy = new SpeechPolicy("verbatim");
  const chunks = policy.consume({
    type: "assistant_text",
    payload: { delta: "Here is the fix:\n```ts\nconst value = 1;\n```" },
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.text, "Here is the fix:");
  assert.match(chunks[1]?.text ?? "", /code block/);
});

test("summary mode speaks once at turn completion", () => {
  const policy = new SpeechPolicy("summary");
  assert.deepEqual(policy.consume({ type: "assistant_text", payload: { delta: "A detailed answer. More detail." } }), []);
  assert.deepEqual(policy.consume({ type: "turn_complete", payload: {} }), [
    { id: "speech-1", sequence: 1, kind: "summary", text: "A detailed answer." },
  ]);
});

test("questions and permissions are spoken in every mode", () => {
  for (const mode of ["verbatim", "summary", "questions_only"] satisfies SpeechMode[]) {
    const policy = new SpeechPolicy(mode);
    assert.equal(policy.consume({ type: "question", payload: { question: "Which file?" } })[0]?.text, "Which file?");
    assert.equal(policy.consume({ type: "permission_request", payload: { tool: "Bash", input: { command: "ls" } } })[0]?.text, "Permission requested for Bash.");
  }
});

test("fake TTS returns deterministic clips and preserves failures", async () => {
  const provider: TtsProvider = new FakeTtsProvider();
  const chunk: SpeechChunk = { id: "speech-1", sequence: 1, kind: "assistant", text: "Hello." };
  assert.deepEqual(await provider.synthesize(chunk), { clipId: "speech-1", mimeType: "audio/wav", data: "FAKE_AUDIO" });
  await assert.rejects(() => new FakeTtsProvider({ fail: true }).synthesize(chunk), /fake TTS failure/);
});
