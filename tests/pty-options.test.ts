import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalPtyLaunch, type CreateSessionOptions } from "../api/pty-manager";

test("builds an agent launch with args and removes the API key", () => {
  const options: CreateSessionOptions = {
    args: ["--resume", "session-123", "--permission-mode", "acceptEdits"],
    env: {
      CLAUDE_RUN_SESSION: "internal-123",
      ANTHROPIC_API_KEY: undefined,
    },
    sessionTag: "agent",
  };

  const launch = buildLocalPtyLaunch("/work/repo", "/usr/local/bin/claude", options, {
    SHELL: "/bin/zsh",
    ANTHROPIC_API_KEY: "must-not-leak",
    TERM: "xterm-256color",
  });

  assert.deepEqual(launch.args, [
    "-c",
    "'/usr/local/bin/claude' '--resume' 'session-123' '--permission-mode' 'acceptEdits'",
  ]);
  assert.equal(launch.env.CLAUDE_RUN_SESSION, "internal-123");
  assert.equal(launch.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(launch.env.TERM, "xterm-256color");
});

test("preserves the existing no-options launch shape", () => {
  const launch = buildLocalPtyLaunch("/work/repo", "claude", undefined, {
    SHELL: "/bin/zsh",
    TERM: "xterm-256color",
  });

  assert.deepEqual(launch.args, ["-c", "'claude'"]);
  assert.equal(launch.cwd, "/work/repo");
});
