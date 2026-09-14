import assert from "node:assert/strict";
import test from "node:test";

import { parseVoiceIntent, resolveSession } from "../api/intent.js";

test("parses exact controls and permission answers", () => {
  assert.deepEqual(parseVoiceIntent("stop speaking"), { kind: "stop" });
  assert.deepEqual(parseVoiceIntent("repeat"), { kind: "repeat" });
  assert.deepEqual(parseVoiceIntent("new session"), { kind: "new_session" });
  assert.deepEqual(parseVoiceIntent("always allow"), { kind: "permission", allow: true, always: true });
  assert.deepEqual(parseVoiceIntent("deny"), { kind: "permission", allow: false });
});

test("falls back to a prompt without interpreting ordinary speech", () => {
  assert.deepEqual(parseVoiceIntent("please explain the failing test"), {
    kind: "prompt",
    text: "please explain the failing test",
  });
});

test("selects one session and refuses ambiguous matches", () => {
  const sessions = [
    { id: "one", display: "Fix tests" },
    { id: "two", display: "Fix docs" },
    { id: "three", display: "Deploy" },
  ];
  assert.deepEqual(resolveSession("deploy", sessions), { kind: "selected", session: sessions[2] });
  assert.deepEqual(resolveSession("fix", sessions), { kind: "ambiguous", matches: sessions.slice(0, 2) });
  assert.deepEqual(resolveSession("missing", sessions), { kind: "not_found" });
});
