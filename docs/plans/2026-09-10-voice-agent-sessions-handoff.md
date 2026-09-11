# Voice Agent Sessions — Implementation Handoff

Plan: `docs/plans/2026-09-10-voice-agent-sessions-implementation.md`
Branch: `feature/voice-agent-sessions`

## Current status

Slice 2 ingestion is implemented and verified. Terminal-session creation, deduplication, reconnection, startup logging, and active-terminal/history linking are implemented and verified. The local `apex-opportunities` smoke test passed: one active terminal was created, repeated request IDs reused the same PTY, Active Terminals linked to the matching persisted conversation, and existing-history selection continued to work. The next session should begin with Slice 3 PTY options/fake-driver work.

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

Before claiming terminal behavior complete in the next session, run:

```bash
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
DATABASE_URL=postgresql://bsolga@localhost:5432/claude_run pnpm dev
```

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
