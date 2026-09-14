# Voice Agent Sessions — Implementation Handoff

Plan: `docs/plans/2026-09-10-voice-agent-sessions-implementation.md`
Branch: `feature/voice-agent-sessions`

## Current status

Slice 3 PTY options and fake-driver foundation is implemented and verified. Agent SDK/API contract verification is recorded in `docs/plans/2026-09-12-agent-sdk-contract.md`. A database-backed per-session and per-day API-equivalent cost tracker is exposed in the UI and `/api/costs`; multi-root discovery includes `~/.claude` and `~/.claude-nix`. Subscription-aware accounting, profile configuration, and live context measurement are future Settings work; do not present API-equivalent dollars as subscription billing or infer Pro/Max tier from login state.

### Slice 3 files and verification

- Added `CreateSessionOptions`, `LocalPtyLaunch`, and `buildLocalPtyLaunch` in `api/pty-manager.ts`; existing `createSession(repo, hostId)` call sites remain valid.
- Added `api/drivers/agent-driver.ts` with the driver contract, agent state transitions, and `FakeAgentDriver`.
- Added `tests/pty-options.test.ts` and `tests/agent-driver.test.ts`.
- `bun test tests/pty-options.test.ts`: PASS — 2 passed.
- `bun test tests/agent-driver.test.ts`: PASS — 2 passed.
- `bun test`: PASS — 17 passed, 2 skipped without `DATABASE_URL`.
- `bun run type-check`: PASS.
- `git diff --check`: PASS.
- PostgreSQL integration tests were not rerun; they remain skipped without `DATABASE_URL`.

The implementation quotes the executable and arguments inside the shell command to preserve spaces and prevent argument injection. Agent-tagged launches remove `ANTHROPIC_API_KEY` after applying explicit environment overrides.

The Hono peer warning is intentionally left unresolved: `@hono/node-ws@1.3.1` declares `@hono/node-server@^1.19.11`, while this project uses `@hono/node-server@2.1.1`. Do not change versions unless requested or until a peer-compatible `@hono/node-ws` release exists.

## Completed implementation

### Database and queue foundation

- Added Drizzle/PostgreSQL configuration, schema, migrations, and database client under `api/db/`.
- Added `claude_run.conversations`, `claude_run.messages`, and `claude_run.usage_turns`.
- Kept pg-boss in its separate `pgboss` schema.
- Added the `claude-run.ingest` queue with retry policy and file-path singleton keys.
- Added worker registration and explicit instrumentation startup/shutdown in `api/instrumentation.ts`.
- Added local database fallback/configuration and database setup scripts.

### JSONL ingestion

- Added `api/conversation-ingest.ts`.
- Parses valid user/assistant JSONL records while ignoring malformed/incomplete lines.
- Builds idempotent conversation/message records.
- Uses absolute JSONL paths as ingest singleton keys.
- Persists assistant usage turns with input, output, cache-read tokens, model, and nullable cost.
- Repeated ingestion updates existing rows instead of duplicating them.
- Added initial startup scanning of existing session JSONL files.
- Watcher changes enqueue ingestion jobs through the queue runtime.

### Logging

- Ingest enqueue messages are debug-only.
- Deduplicated enqueue attempts produce no log message.
- Startup scan emits only a debug summary of files considered and jobs actually accepted.
- Default startup logs no longer print one info-level line per JSONL file.

### Terminal sessions/UI

- Added local/remote terminal session management through `node-pty` and WebSockets.
- Added active-terminal list and new-session modal.
- Added stable new-session request IDs to avoid duplicate PTYs during React StrictMode/reconnect behavior.
- Existing terminal-session selection connects through `/api/terminals/:id`.
- Fixed stale WebSocket callbacks and retry timers that could cause frequent terminal-pane refreshes.
- Removed the forced `TerminalPanel` remount that was contributing to refresh behavior.
- Fixed the existing-session WebSocket path type narrowing.
- `node-pty` on this macOS install required:
  `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
  This is an install-state issue and may recur after dependency reinstall.

### Development startup

- Replaced `__dirname` in `web/vite.config.ts` with an `import.meta.url`-based path.
- Development API no longer registers production `serveStatic`/fallback handlers, so the missing `dist/web` warning is avoided during `pnpm dev`.
- Vite-to-API `ECONNREFUSED` messages can still occur during the startup race because Vite begins before API port 12001 is listening; the next hardening task may be readiness ordering if it remains noisy.

## Verification

Latest verification from the current working tree:

- `bun run type-check`: PASS.
- `bun test`: PASS — 13 passed, 2 skipped without `DATABASE_URL`.
- `git diff --check`: PASS.
- `bun test tests/queue-logging.test.ts`: PASS.
- PostgreSQL-enabled Slice 1/Slice 2 integration tests previously passed with local Postgres.app using:
  `DATABASE_URL=postgresql://bsolga@localhost:5432/claude_run bun test`
- `pnpm update`: completed with no packages beyond declared ranges updated.
- Current pnpm warnings are the known Hono peer mismatch and deprecated transitive `@esbuild-kit/*` packages from `drizzle-kit`.

Terminal behavior has now been smoke-tested locally. For a future fresh install, run:

```bash
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
DATABASE_URL=postgresql://<local-user>@localhost:5432/claude_run pnpm dev
```

Do not copy credentials into documentation or logs.

The verified commit containing the completed foundation and terminal-linking work is:
`a842e9d Add voice agent session foundation and terminal linking`

The latest handoff update is committed as:
`2193603 Update voice session handoff`.

The development server used for smoke testing was process `proc_6b7b4125d322`; stop it before starting another copy if it is still running.

Git status was clean immediately after the commit.

## Latest smoke-test result

- Created an `apex-opportunities` terminal over the WebSocket endpoint.
- Repeated creation with the same request ID returned the same PTY session ID.
- Connected to that PTY through `/api/terminals/:id` and received the same ID.
- Confirmed active-terminal/history identity is resolved by repository: the Active Terminals entry selects the newest persisted conversation for its repo.
- Existing history selection remained functional.
- Temporary smoke-test terminal sessions were deleted afterward.

## Future planned work: subscription and context settings

The minimal Settings pane should become the explicit configuration boundary for multiple Claude Code accounts/profiles. Add this after the current driver work rather than inferring values from local authentication state.

- Configure named profiles that bind a Claude data root to a subscription tier: `pro`, `max-5x`, or `max-20x`.
- Include the current roots as initial choices: `~/.claude` and `~/.claude-nix`.
- Capture live status-line JSON for claude-run-launched sessions, using `context_window.used_percentage` as the authoritative active-context signal.
- Persist the latest context percentage/window and profile identity per session; use historical token usage only as a visibly labeled fallback estimate.
- Display API-equivalent usage separately from subscription usage/quota. Never divide API cost by 5 or 20: those are usage multipliers, not a documented dollar discount.
- Keep subscription-adjusted cost unavailable until a verified quota/accounting rule is configured or supplied by the user.

Detailed findings and the proposed configuration shape are in `docs/plans/2026-09-12-cost-subscription-context.md`.

## Next implementation step

Slices 1 and 2 of the voice plan are complete: the in-memory text-only `AgentManager` and minimal routes are committed as `f495405`; agent WebSocket transport with ordered replay and reconnect-safe subscription is committed as `97cf165`. Slice 3 is now complete in the working tree: outbound speech policy and deterministic fake TTS are implemented. The next first action is to add outbound audio delivery/playback while keeping text events independent.

Before modifying code, inspect `api/pty-manager.ts`, `api/server.ts`, current terminal tests, and package scripts. Do not add the Agent SDK until its current API/authentication/billing/resume contract is verified as required by Phase 0.

## Known warnings/blockers

- `@hono/node-ws@1.3.1` peer warning against `@hono/node-server@2.1.1` is intentionally accepted.
- `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` are deprecated transitive dependencies pulled by `drizzle-kit`; they are not direct dependencies.
- `pnpm build` previously failed at the existing `tsup`/`rollup-plugin-dts` incompatibility (`useCaseSensitiveFileNames`); rerun if production build is needed.
- The repository has many intentional uncommitted changes and untracked files. Do not reset, clean, commit, or modify unrelated work.
- `.serena/` and `tmp/` are present as tracked support paths.
- Credentials/connection-string values must not be copied into the handoff or logs.

## Files changed in the current work

Core/runtime:

- `api/index.ts`
- `api/server.ts`
- `api/storage.ts`
- `api/conversation-ingest.ts`
- `api/instrumentation.ts`
- `api/db/*`
- `api/jobs/*`
- `api/utils/logger.ts`
- `scripts/db/*`
- `drizzle.config.ts`

Frontend:

- `web/app.tsx`
- `web/components/terminal-panel.tsx`
- `web/hooks/use-terminal.ts`
- `web/vite.config.ts`

Tests:

- `tests/slice1-foundation.test.ts`
- `tests/slice1-foundation.integration.test.ts`
- `tests/slice2-ingest.test.ts`
- `tests/slice2-ingest.integration.test.ts`
- `tests/slice2-initial-scan.test.ts`
- `tests/slice2-usage.test.ts`
- `tests/slice2-watcher.test.ts`
- `tests/queue-logging.test.ts`
- `tests/smoke.test.ts`
- `tests/instrumentation.test.ts`

Plans/supporting files:

- `docs/plans/2026-09-07-voice-agent-sessions-design.md`
- `docs/plans/2026-09-10-voice-agent-sessions-implementation.md`
- this handoff document
- `package.json`, `pnpm-lock.yaml`, `bun.lock`, `pnpm-workspace.yaml`

## Precise first step in the next session

Read this handoff, inspect `git status --short --branch`, then verify the installed Claude CLI and official Agent SDK/API contract before adding an SDK dependency. Preserve the existing terminal behavior and keep the Hono peer warning unchanged.

## Historical implementation notes

- `node-pty` initially failed on macOS because `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` lacked its executable bit. The local install was repaired with `chmod +x`; a durable package-install hook may be needed later.
- Vite's `__dirname` native-loader warning was removed by using an `import.meta.url`-based path.
- Development API static-file handling now skips `serveStatic`/fallback registration; Vite owns frontend serving during `pnpm dev`.
- Vite may still emit transient `ECONNREFUSED` proxy messages if the browser requests API routes before port 12001 is ready; API readiness ordering can be hardened later if needed.
- Do not interpret the PTY ID as a Claude conversation ID. Resolve history selection using the terminal repository and the newest persisted conversation until a direct mapping is added.

## Previous verification details

- Type-check: PASS.
- Full test suite: 13 pass, 2 skip without `DATABASE_URL`.
- PostgreSQL-enabled Slice 1/Slice 2 integration tests previously passed using local Postgres.app.
- `git diff --check`: PASS.
- `pnpm update`: completed without changes beyond declared ranges; known Hono/deprecation warnings remain.

## Prior plan note

The original handoff's Slice 2 acceptance note is retained in git history. The current handoff supersedes its former "precise first step" and verification wording.

## End of handoff

Read the sections above before continuing work.

## Legacy record

The initial Slice 1/Slice 2 handoff recorded the following historical details:

- Slice 1 created `claude_run` and `pgboss`, added Drizzle/pg-boss, and verified queue startup.
- Slice 2 added idempotent JSONL ingest, usage/cost persistence, initial scan, and watcher enqueueing.
- Existing file-based reads and SSE behavior were intentionally preserved.
- Build failure `useCaseSensitiveFileNames` is a known baseline issue, not a reason to reset this branch.
- The Hono peer mismatch remains intentionally accepted until `@hono/node-ws` publishes a compatible release.

## End

The next agent should not repeat completed Slice 1/Slice 2 work. Begin with Slice 3 as specified above.

## Original detailed file list

- `api/index.ts`
- `api/server.ts`
- `api/storage.ts`
- `api/conversation-ingest.ts`
- `api/instrumentation.ts`
- `api/db/*`
- `api/jobs/*`
- `api/utils/logger.ts`
- `scripts/db/*`
- `drizzle.config.ts`
- `web/app.tsx`
- `web/components/terminal-panel.tsx`
- `web/hooks/use-terminal.ts`
- `web/vite.config.ts`
- `tests/*`
- `docs/plans/*`
- `package.json`
- `pnpm-lock.yaml`
- `bun.lock`
- `pnpm-workspace.yaml`
- `tmp/.keep`
- `.serena/*`

## Handoff completion marker

This document was updated after the local terminal smoke test and commit. Use commit `a842e9d` as the stable continuation point.

## End of current record

No further action is required in this session unless the user requests Slice 3 implementation.

## Superseded note

The following older instruction is superseded: run the local manual smoke test before claiming terminal behavior complete. That smoke test has already passed.

## Session continuation contract

At the start of the next session:

1. Read this document.
2. Verify `git status --short --branch`.
3. Do not alter dependency versions for the Hono warning.
4. Start Slice 3 with a failing test.
5. Preserve current terminal, SSE, watcher, and ingestion behavior.

## End marker

Handoff is complete at commit `a842e9d`.

## Previous precise first step (superseded)

Read the remaining Slice 2 acceptance criteria. Add usage/cost rollup persistence only after checking the actual fixture shape, then add a focused watcher enqueue-boundary test. Keep existing file-based reads and SSE behavior unchanged.

## Previous baseline record

The initial handoff documented baseline type-check failures in `api/server.ts`; those errors have since been resolved. Current type-check passed.

## Final continuation note

Continue from `a842e9d`, not from the pre-commit working tree. The next feature is PTY options and fake-driver coverage.

## End of document

Manual smoke-test checklist:

1. Existing sessions load in the browser.
2. Create exactly one terminal session for `apex-opportunities`.
3. Confirm exactly one active-terminal entry appears.
4. Click that entry and confirm it reconnects to the same PTY.
5. Confirm the terminal pane does not repeatedly clear/reconnect.
6. Type input and resize the terminal.
7. Close/reopen the terminal panel and reconnect from the active list.
8. Confirm no duplicate PTY appears in `GET /api/terminals`.

## Known warnings/blockers

- `@hono/node-ws@1.3.1` peer warning against `@hono/node-server@2.1.1` is intentionally accepted.
- `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` are deprecated transitive dependencies pulled by `drizzle-kit`; they are not direct dependencies.
- `pnpm build` previously failed at the existing `tsup`/`rollup-plugin-dts` incompatibility (`useCaseSensitiveFileNames`); rerun if production build is needed.
- The repository has many intentional uncommitted changes and untracked files. Do not reset, clean, commit, or modify unrelated work.
- `.serena/` and `tmp/` are present as untracked paths; inspect before any cleanup decision.
- Credentials/connection-string values must not be copied into the handoff or logs.

## Files changed in the current work

Core/runtime:

- `api/index.ts`
- `api/server.ts`
- `api/storage.ts`
- `api/conversation-ingest.ts`
- `api/instrumentation.ts`
- `api/db/*`
- `api/jobs/*`
- `api/utils/logger.ts`
- `scripts/db/*`
- `drizzle.config.ts`

Frontend:

- `web/app.tsx`
- `web/components/terminal-panel.tsx`
- `web/hooks/use-terminal.ts`
- `web/vite.config.ts`

Tests:

- `tests/slice1-foundation.test.ts`
- `tests/slice1-foundation.integration.test.ts`
- `tests/slice2-ingest.test.ts`
- `tests/slice2-ingest.integration.test.ts`
- `tests/slice2-initial-scan.test.ts`
- `tests/slice2-usage.test.ts`
- `tests/slice2-watcher.test.ts`
- `tests/queue-logging.test.ts`
- `tests/smoke.test.ts`

Plans/supporting files:

- `docs/plans/2026-09-07-voice-agent-sessions-design.md`
- `docs/plans/2026-09-10-voice-agent-sessions-implementation.md`
- this handoff document
- `package.json`, `pnpm-lock.yaml`, `bun.lock`, `pnpm-workspace.yaml`

## Precise first step in the next session

Read this handoff, inspect `git status --short --branch`, then run the manual terminal smoke test with `DATABASE_URL` and verify the `apex-opportunities` create/select/reconnect path before making further code changes. If it fails, capture browser/API WebSocket evidence and fix the smallest failing lifecycle boundary. If it passes, begin Slice 3 with PTY options and a fake-driver test seam.
