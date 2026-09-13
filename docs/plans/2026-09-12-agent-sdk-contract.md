# Agent SDK Contract Verification

Date: 2026-09-12

## Verified local CLI

- `claude --version` returned `2.1.269 (Claude Code)`.
- `claude --permission-mode acceptEdits --help` succeeded.
- Supported permission modes include `default`, `acceptEdits`, `auto`, `manual`, `dontAsk`, `plan`, and `bypassPermissions` in the CLI help; the current Agent SDK documentation uses `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, and `auto`.
- `--resume`, `--session-id`, `--model`, `--max-budget-usd`, `--permission-mode`, `--setting-sources`, and `--output-format` are available in the installed CLI.
- `claude auth status` reported an authenticated claude.ai Max subscription. This verifies the local CLI login only; it does not authorize an SDK-backed product or establish API billing equivalence.

## Verified Agent SDK package/documentation

- Current npm package: `@anthropic-ai/claude-agent-sdk@0.3.269`.
- Package `claudeCodeVersion`: `2.1.269`, matching the installed CLI patch version.
- Primary API: `query({ prompt, options })`, returning an async generator of streamed SDK messages.
- The package bundles a native Claude Code binary as an optional platform dependency. The package can instead use an explicitly configured executable path; package-manager optional-dependency handling must be verified in this repository before production use.
- Relevant options documented: `cwd`, `model`, `maxTurns`, `maxBudgetUsd`, `maxThinkingTokens`, `permissionMode`, `canUseTool`, `settingSources`, `resume`, `forkSession`, `abortController`, and `pathToClaudeCodeExecutable`.
- Permission callback: `canUseTool(toolName, input, options)` receives an abort signal, tool-use ID, request ID, decision reason, and suggestions. It returns an allow/deny result, or `null` only when an out-of-band control response has already been sent. The application must not return `null` while merely waiting for a UI response.
- Permission evaluation happens before/around the callback; `acceptEdits` and broad allow rules can auto-approve operations without invoking `canUseTool`. Use explicit settings/hooks if every tool call must be gated.
- Settings loading is explicit through `settingSources: ["user", "project", "local"]`; an empty list disables filesystem settings loading.
- Session continuity is provided through `resume` and `forkSession`; `session_id` is emitted in system messages. The SDK also exposes `listSessions`, `getSessionMessages`, and related session helpers.
- Result messages expose `usage`, `modelUsage`, and `total_cost_usd`. `modelUsage` includes input/output/cache token fields, cost estimate, model/provider, context window, and max output tokens. `total_cost_usd` is an estimate, not a billing statement.
- The SDK overview explicitly distinguishes Agent SDK/API usage from claude.ai login and says third-party products should use API-key authentication methods rather than offer claude.ai login or rate limits. The existing local Max login therefore remains a PTY/CLI fallback assumption, not an SDK billing assumption.

## Implementation constraints

- Add the SDK only as a deliberate dependency and keep it behind `SdkDriver`.
- Treat unknown usage, pricing, provider, or budget state as a refusal/fail-closed condition for production agent turns.
- Inject the `query` function at the driver boundary for unit tests; do not make tests depend on a live account or network.
- Keep the existing `PtyHookDriver`/subscription path separate because switching between SDK/API and CLI changes authentication and billing.
- Verify optional native binary installation and a real one-turn SDK invocation separately before claiming live SDK execution.

Sources:

- https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript
- https://docs.anthropic.com/en/docs/claude-code/sdk/overview
- https://docs.anthropic.com/en/docs/claude-code/sdk/permissions
- `npm view @anthropic-ai/claude-agent-sdk version dist-tags`
- local `claude --version`, `claude --help`, and `claude auth status`
