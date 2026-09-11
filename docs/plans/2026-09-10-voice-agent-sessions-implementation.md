# Voice Agent Sessions — Implementation Plan

**Date:** 2026-09-10
**Design:** `docs/plans/2026-09-07-voice-agent-sessions-design.md`
**Status:** Proposed implementation plan

## Goal

Add voice-first Claude Code agent sessions to `claude-run` without changing the existing terminal-session or conversation-browser paths. The implementation will:

- run interactive `claude` through the existing local PTY machinery;
- derive structured agent events from Claude Code hooks and JSONL transcripts;
- persist terminal, SDK/API agent, PTY agent, and CLI conversations in PostgreSQL;
- process STT, TTS, summaries, notifications, and JSONL ingest asynchronously with pg-boss;
- expose text and voice controls through Hono routes, WebSocket events, and global SSE notices;
- add a mobile-first agent UI while retaining the raw terminal fallback.

The first Claude execution deliverable is `SdkDriver` using the verified Agent SDK/API contract. `PtyHookDriver` remains an explicit secondary driver for subscription-authenticated CLI compatibility and fallback.

## Existing project constraints

`claude-run` is a small TypeScript ESM application with:

- Hono and `@hono/node-server` in `api/server.ts`;
- `node-pty` sessions managed in `api/pty-manager.ts`;
- Claude JSONL/history reads in `api/storage.ts`;
- Chokidar-based updates in `api/watcher.ts`;
- Vite/React UI in `web/`;
- no database, ORM, migrations, test runner, or job queue today;
- `pnpm build` and `pnpm type-check` as the existing verification commands.

The existing terminal API must remain behaviorally compatible. Agent sessions are additive and local-host-only.

## Reuse decisions from the reference projects

### apps-manager: pg-boss and async processing

Reuse the architecture, not application-specific repositories or Next.js code:

- `src/lib/jobs/queue.ts`
  - singleton `PgBoss` instance;
  - `DATABASE_URL` validation;
  - explicit `schema` configuration;
  - start/stop lifecycle;
  - queue creation at startup;
  - `singletonKey` for deduplicated jobs.
- `src/lib/jobs/types.ts`
  - typed queue-name constants and per-job payload types.
- `src/lib/jobs/workers/index.ts`
  - one registration function that registers workers in parallel after pg-boss starts.
- `src/lib/jobs/workers/*`
  - thin registration function plus separately testable handler;
  - batch handling with `batchSize: 1` where work is session-sensitive;
  - structured logging and explicit retry behavior.
- `src/lib/services/workers.service.ts`
  - only the operational pattern is relevant: inspect queue state through a service/repository boundary if observability is added later.

Do not copy the apps-manager `@/` aliases, Next.js lifecycle, application repositories, or unrelated repair pipeline state.

### apps-manager: partial Claude Code integration

Reuse the safe process-boundary ideas from:

- `src/lib/services/fix-runner.ts`;
- `src/lib/services/fix/claude-invoker.ts`;
- `src/lib/jobs/workers/fix-worker.ts`.

Specifically:

- clone the environment before spawning and explicitly remove `ANTHROPIC_API_KEY` for subscription-backed Claude Code sessions;
- use an abort/timeout boundary and report duration, chunk count, last output time, exit status, and timeout state;
- keep Claude invocation behind a service/driver boundary rather than embedding process handling in route handlers;
- stream incremental output/events while retaining a final result;
- separate orchestration, validation, persistence, and failure handling;
- make callbacks non-fatal where they must not kill the Claude session.

Use apps-manager's Agent SDK invocation as the primary implementation reference, but isolate it behind `SdkDriver` and verify the current package/API, authentication, usage, resume, permission, and billing contracts before coding. Keep `PtyHookDriver` as the secondary interactive-CLI path for subscription billing, hook/TUI compatibility, and explicit fallback. Never switch drivers silently because billing differs.

### finances-manager: multi-schema database layout

Reuse the Drizzle/PostgreSQL conventions from:

- `src/lib/core/db/schema/enums.ts`: define named schemas with `pgSchema(...)`;
- schema-specific table modules such as `banking.schema.ts`;
- `src/lib/core/db/schema/index.ts`: explicit schema/table/type re-exports;
- `src/lib/core/db/index.ts`: `pg` pool plus Drizzle database singleton;
- `drizzle.config.ts`: PostgreSQL dialect, schema glob, and `schemaFilter`;
- `scripts/db/sql/init-schemas.sql`: idempotent `CREATE SCHEMA IF NOT EXISTS` bootstrap.

For this project use a dedicated application schema, initially `claude_run`, and a separate `pgboss` schema for pg-boss. Keep pg-boss tables out of `claude_run`. If the chosen Drizzle version cannot represent the desired pg-boss schema cleanly, pg-boss remains authoritative for its own tables and the application migrations manage only `claude_run`.

## Phase 0 — Confirm external contracts before coding

1. Pin the Claude Code CLI version available on the target VM and record the output of:
   - `claude --version`;
   - `claude --help`;
   - `claude --permission-mode acceptEdits --help` if supported.
2. Verify hook payloads and response envelopes against the current Claude Code hook reference. Current documentation indicates that `PreToolUse` decision output belongs under `hookSpecificOutput.permissionDecision`, with `allow`, `deny`, `ask`, and `defer`; `AskUserQuestion` requires `updatedInput` when answered through a hook. The implementation must not assume the older top-level `decision` format.
4. Verify the current Agent SDK/API package, authentication, billing, resume/session semantics, usage fields, permission callbacks, `settingSources`, model selection, max-output-token options, abort support, and structured stream/result messages. This verification is required before implementing `SdkDriver`.
5. Resolve the difference between the design's listed hook events and current docs:
   - use `SessionStart`, `PreToolUse`, `PermissionRequest`, `Stop`, and `Notification` where supported;
   - retain a PTY/TUI fallback for anything that cannot be answered through hooks;
   - add a `PostToolUse`/JSONL fallback only if needed for tool-result detail.
6. Confirm the target VM has the repositories checked out, the selected SDK/API authentication is available, and a secure phone-facing URL. `MediaRecorder` requires a secure context outside localhost. Keep subscription login verification for the explicit PTY fallback.
7. Decide whether migration execution is done by `drizzle-kit migrate` or checked-in SQL plus a small migration runner.

Deliverable: a short `docs/plans/` contract note or an updated plan section containing captured CLI/docs assumptions. Do not implement hooks against unverified payload shapes.

## Phase 1 — Foundation: dependencies, configuration, database, and queue lifecycle

### Files to add

- `api/config.ts`: validate and expose `DATABASE_URL`, API keys, audio settings, hook timeout, public URL, summary backend, and retention settings.
- `api/db/client.ts`: `pg` pool and Drizzle singleton, modeled after finances-manager's `src/lib/core/db/index.ts`.
- `api/db/schema/enums.ts`: `claude_run` schema definition and enum definitions.
- `api/db/schema/conversations.ts`.
- `api/db/schema/agents.ts`.
- `api/db/schema/audio.ts`.
- `api/db/schema/index.ts`: explicit exports.
- `api/db/migrations/*.sql` or generated Drizzle migrations.
- `scripts/db/init-schemas.sql`: idempotently create `claude_run` and `pgboss`.
- `api/jobs/types.ts`.
- `api/jobs/queue.ts`.
- `api/jobs/workers/index.ts`.

### Dependencies

Add the smallest set needed:

- `drizzle-orm`;
- `drizzle-kit` as a dev dependency;
- `pg` and `@types/pg`;
- `pg-boss`;
- a multipart/body parser only if Hono's built-in request parsing is insufficient for audio upload;
- test tooling only after selecting a runner compatible with the current pnpm/TS setup.

Update `drizzle.config.ts`, package scripts, `pnpm-lock.yaml`, and `.env.example`. Do not add the Agent SDK as a runtime dependency for this phase.

### Database model

Create the design's tables in `claude_run`:

- `conversations`: Claude session identity, project path, origin, display metadata, first/last seen.
- `messages`: unique JSONL UUID, conversation FK, role, content JSONB, usage JSONB, timestamp, parent UUID.
- `agent_sessions`: internal ID, nullable Claude session ID until `SessionStart`, repo/name, speech mode, accept-edits flag, state, driver, lifecycle timestamps.
- `agent_events`: session ID, monotonically increasing `seq`, type, payload JSONB, timestamp; unique `(session_id, seq)`.
- `pending_prompts`: permission/question state, payload, resolution timestamp and response.
- `usage_turns`: model/token fields and estimated cost.
- `audio_clips`: uploaded/TTS clip metadata and file path.
- `model_prices`: effective-dated model price rows.

Use explicit indexes for session lookup, event replay, JSONL UUID upsert, pending prompts, and retention queries. Use database-generated timestamps and constraints for enum-like values where practical. JSONB is used for evolving Claude payloads, but route and worker boundaries validate input before persistence.

### Queue design

Create these queue constants and payload types:

- `stt`: `{ agentSessionId, audioClipId, path }`;
- `tts`: `{ agentSessionId, text, kind, sequence }`;
- `summarize`: `{ agentSessionId, turnId, text }`;
- `notify`: `{ agentSessionId, noticeType, text }`;
- `ingest`: `{ path, sessionId? }`;
- `audio_cleanup`: `{ before }`.

Configure retries as specified by the design: STT 2 with backoff, TTS 2, summarize 1, notify 1, ingest 3, and singleton ingest by path. Start pg-boss once during server startup, create queues idempotently, register workers, and stop it during server shutdown before closing the DB pool. If `DATABASE_URL` is absent or DB startup/migration health checks fail, refuse to start rather than silently falling back to files.

Acceptance criteria:

- `bun run type-check` is the preferred baseline command for this branch; existing TypeScript baseline errors are tracked separately and must not be hidden by feature changes;
- a test or local integration command proves queue startup, queue creation, and graceful shutdown;
- migration bootstrap creates only the intended schemas/tables;
- existing `pnpm build` still passes.

## Test strategy and scope

Keep automated coverage deliberately small and behavior-focused. This feature spans a PTY, Claude hooks, PostgreSQL, pg-boss, external speech providers, and a browser; attempting to integration-test every boundary would make the suite slow, brittle, and dependent on a live Claude account.

### Unit tests: the highest-value pure and stateful functions

Unit-test the functions that encode product behavior or protect data integrity:

- JSONL line parsing and normalization, including incomplete/malformed lines;
- usage extraction and model-price/cost calculation;
- hook payload parsing and safe decision-envelope generation;
- intent parsing and deterministic session-name matching;
- speech-policy filtering, sentence chunking, and chunk ordering;
- agent state-machine transition validation;
- event sequence/replay filtering and duplicate suppression;
- environment/argument construction for agent PTYs, especially removal of `ANTHROPIC_API_KEY`;
- retry/backoff and safe fallback classification for provider/worker errors;
- hook installer settings merge/uninstall behavior using temporary settings files.

Prefer table-driven tests and real pure functions. Mock only process, clock, filesystem, network, provider, and database boundaries where the dependency is genuinely external. Do not unit-test framework routing, pg-boss internals, React rendering details, or copied implementation details.

### Minimal integration tests

Use one disposable PostgreSQL instance/database and one fake Claude executable. Avoid live Claude, Whisper, ElevenLabs, a public URL, and a real browser in automated tests.

1. **Database/queue smoke test:** apply migrations, verify `claude_run` and `pgboss` are separate, start pg-boss, enqueue one ingest job, run its worker, assert one persisted message, and shut down cleanly.
2. **Idempotent ingest test:** process the same fixture twice and assert no duplicate conversation/message rows; this also covers the watcher singleton-key contract without testing Chokidar itself.
3. **Agent tracer-bullet test:** start the fake Claude process through `PtyHookDriver`, emit a `SessionStart`, one prompt/assistant event, and one permission callback, then assert persisted ordered events and a clean exit. Use the fake process to cover resume arguments and environment sanitization.
4. **Replay/API boundary test:** persist a short event sequence, connect with `since`, and assert only missing events are returned in order. Test the route/manager boundary, not the WebSocket library.

These four tests are the integration acceptance gate. Provider adapters, audio playback, PWA behavior, and the full manual voice checklist remain manual/contract checks. If the local environment has no PostgreSQL, run unit tests and the fake-driver test without pretending the database integration passed; report the missing prerequisite.

### Test workflow

For each new pure function or vertical slice, use RED → GREEN → REFACTOR. Run the focused test before implementation and confirm it fails for the expected missing behavior. Then run the focused test, the full unit suite, `bun run type-check`, and the existing `pnpm build` at phase boundaries. The Docker daemon is intentionally not required for local progress; PostgreSQL tests use Postgres.app when its server is running. Do not require every planned test before the first implementation slice.

## Phase 2 — Conversation ingest and watcher integration

### Implementation

Add an ingest adapter around the existing `api/storage.ts` readers rather than replacing them:

- export a reusable JSONL line parser from `storage.ts` or a new `api/conversation-parser.ts`;
- preserve current file-based reads and stream offsets;
- parse only complete lines and tolerate malformed lines as the current reader does;
- upsert `conversations` and `messages` by Claude UUID;
- derive `usage_turns` from assistant messages' `usage` and `model` fields;
- estimate cost from `model_prices`, with an explicit `unknown`/null result when no price is available;
- identify origin as `agent` when an internal agent mapping exists, otherwise `terminal`/`cli` from available metadata.

Modify `api/watcher.ts` so a changed JSONL path emits its existing events and enqueues one debounced `ingest` job using the absolute path as `singletonKey`. Do not make DB ingest a prerequisite for the existing SSE file stream.

Perform an initial scan after DB/queue startup so existing sessions are mirrored, then rely on watcher events. Make the worker idempotent and safe if a file is deleted or rotated between enqueue and execution.

Tests:

- unit-test the parser, usage/cost mapping, and duplicate handling;
- cover repeated ingest in the single idempotent-ingest integration test;
- verify existing `getConversation` and `getConversationStream` behavior with the existing build/type checks and one focused regression test if the touched code changes those paths;
- do not add a separate Chokidar integration test; verify the singleton key at the enqueue boundary.

## Phase 3 — PTY options and driver boundary

### PTY changes

Extend `api/pty-manager.ts` with an options object while preserving existing call sites:

```ts
interface CreateSessionOptions {
  env?: Record<string, string | undefined>;
  args?: string[];
  sessionTag?: "terminal" | "agent";
}
```

For local sessions:

- validate `repo` exactly as today;
- merge safe environment overrides;
- explicitly remove `ANTHROPIC_API_KEY` for the agent driver and assert it is absent before spawning;
- retain `TERM`, shell, history buffering, timeout, client management, and existing terminal behavior.

Do not enable agent sessions on SSH hosts in this project.

### Driver files

Add:

- `api/drivers/agent-driver.ts`: `AgentDriver`, `DriverEvent`, and payload types from the design;
- `api/drivers/sdk-driver.ts`: primary Agent SDK/API driver;
- `api/drivers/pty-hook-driver.ts`;
- `api/agent-events.ts`: typed event normalization and sequence helpers if needed.

`PtyHookDriver` responsibilities:

1. Create the internal ID before spawning.
2. Ensure hook configuration is installed or report degraded mode.
3. Start `claude` in the repo with optional `--resume <sessionId>` and `--permission-mode acceptEdits`.
4. Pass `CLAUDE_RUN_SESSION` and a loopback/public hook URL only for the agent PTY.
5. Discover the Claude session ID from `SessionStart`; use a narrowly scoped JSONL fallback if the hook is unavailable.
6. Tail only the matched transcript and normalize complete JSONL messages into assistant text, tool-use, tool-result, and usage events.
7. Receive hook callbacks through a driver-owned pending-request map with a timeout based on `HOOK_TIMEOUT_S`.
8. Queue prompts until the PTY is idle; send prompt text with `\r` only after the state check.
9. Resolve permission/question requests using hook `updatedInput` where supported, otherwise use the raw terminal fallback and expose degraded status.
10. Abort/kill cleanly and surface PTY exit code/signal.

Use the apps-manager timeout and streaming pattern: record start time, output/event counts, last event time, timeout state, and final exit data. No route should directly write to the PTY.

Tests:

- unit-test lifecycle/state transitions, prompt queueing, hook timeout fallback, and argument/environment construction;
- cover the fake Claude process, hook callback, resume argument, persisted events, and clean exit in the single agent tracer-bullet integration test.

## Phase 4 — Hook installation and hook API

### Hook script

Add `scripts/claude-run-hook.sh` as a small stdin-JSON-to-HTTP adapter:

- no-op and exit successfully when `CLAUDE_RUN_SESSION` is unset;
- read the hook JSON from stdin;
- post only to the configured local hook endpoint;
- preserve the hook event name and payload without normalization in the script;
- print the server's JSON decision for blocking events;
- return the safe fallback decision on timeout or unknown session;
- never log secrets or transcript contents by default.

Prefer shell only if the target VM's shell and `curl` guarantees are documented. Otherwise use a Node script shipped with the server and invoke it by absolute path.

### Installer

Add an idempotent hook installer module that updates the user settings file without destroying unrelated settings. It must:

- make a timestamped backup before the first modification;
- merge only the claude-run hook entries;
- recognize an existing equivalent installation;
- report installed/degraded state;
- provide an uninstall/restore path for tests and settings UI.

Use user-level settings only if confirmed by the Phase 0 CLI contract check. Never overwrite project settings silently.

### Routes

Add `api/hooks.ts` and register:

- `POST /api/hooks/:internalId/:event`;
- a dedicated `POST /api/hooks/:internalId/pre-tool-use` response path if the generic route makes blocking semantics unclear.

Validate that the request originates from the local process or carries a server-generated per-session secret. Do not trust an arbitrary internal ID from the network. Resolve pending requests exactly once and return a safe result for duplicate/late callbacks.

Unit-test the hook payload parser and response envelopes against captured fixtures from the installed Claude version. The live installed CLI is a manual contract check, not an automated test dependency.

## Phase 5 — Agent manager, persistence, and API

Add `api/agent-manager.ts` as the only component that owns live `AgentSession` objects and driver callbacks.

Responsibilities:

- create/resume/kill live agents;
- map Claude ID and internal ID;
- enforce the state machine: idle → thinking → awaiting permission/question → thinking → idle, or ended;
- persist every normalized event and assign a monotonic sequence in a transaction or serialized per-session writer;
- broadcast events to connected WebSockets;
- publish global notices for non-focused sessions;
- queue TTS/notify work without blocking driver progress;
- restore rows as resumable recent sessions after restart, but do not claim PTYs are still live;
- maintain usage totals and session settings.

Add Hono endpoints:

- `POST /api/agents`;
- `GET /api/agents`;
- `WS /api/agents/:id` with `since`/last-sequence replay;
- `POST /api/agents/:id/audio` returning `202` and an audio row/job ID;
- `POST /api/agents/:id/prompt`;
- `POST /api/agents/:id/respond`;
- `POST /api/agents/:id/interrupt`;
- `PATCH /api/agents/:id`;
- `DELETE /api/agents/:id`;
- `GET /api/agents/events` as global SSE.

Use explicit 400/404/409/413/500 responses. Validate repo paths using the existing PTY validation, constrain upload size/content type, and keep API keys server-side.

Acceptance criteria:

- a text-only agent can be created, resumed, prompted, interrupted, and killed;
- WebSocket reconnect replays events after the last acknowledged sequence without duplicates;
- state and pending prompts survive DB reads and are cleared exactly once on response;
- terminal routes and terminal WebSocket behavior remain unchanged.

## Phase 6 — Pure voice decisions and external providers

### Pure modules first

Add:

- `api/intent.ts`: transcript → `AppCommand | Prompt | Answer`;
- `api/speech-policy.ts`: event + speech mode → sentence chunks/skip decisions;
- `api/voice/types.ts`: STT/TTS provider interfaces;
- `api/voice/whisper.ts`;
- `api/voice/elevenlabs.ts`;
- `api/voice/audio-store.ts`.

Define and test exact command matching before fuzzy matching. Commands include switch, new session, stop, repeat, and answer forms (`yes`, `allow`, `always`, `no`, `deny`, and free text). Session-name matching must be deterministic and report ambiguity instead of guessing.

Speech policy rules:

- `verbatim`: sentence chunking; code blocks become a count/description; tools become one-line summaries;
- `summary`: hold until turn completion, then enqueue summarize;
- `questions_only`: speak questions/prompts and completion;
- permissions/questions always speak;
- chunk IDs/order are persisted so playback can recover.

### Workers

Implement handlers with the apps-manager worker shape:

- registration function;
- separately testable handler;
- bounded provider timeout;
- retry-compatible errors;
- structured logs with session/job IDs;
- final failure behavior matching the design.

STT stores the upload first, transcribes it, echoes the transcript, then executes the parsed command/prompt/answer. TTS writes clips under `AUDIO_DIR`, inserts `audio_clips`, and emits an audio event. Summary failure falls back to the first two sentences. TTS failure never blocks text events. Notify is best effort.

Add cleanup scheduling using pg-boss and delete only files represented by expired rows after a retention query. Prevent path traversal by deriving clip names from generated IDs.

## Phase 7 — Web UI and PWA baseline

Add:

- `web/components/agent-session-view.tsx`;
- `web/components/prompt-card.tsx`;
- `web/components/ptt-button.tsx`;
- `web/hooks/use-agent-session.ts`;
- `web/hooks/use-session-notices.ts`;
- `web/voice/voice-io.ts`;
- `web/voice/media-recorder-voice-io.ts`.

Modify only the routing/state portions of `web/app.tsx`, the session list, and new-session modal:

- tag agent sessions and display state dots;
- add Voice/Terminal selection, with Voice restricted to local host;
- route selected agent sessions to the agent view;
- retain the existing conversation browser and terminal panel;
- add a raw terminal collapsible panel for agent sessions;
- show transcript, state pill, cost/tokens, speech mode, accept-edits setting, rename, and pending prompt actions;
- implement PTT recording on pointer/touch hold and upload on release;
- play ordered clips, support stop/repeat, and handle audio interruption;
- add the PWA manifest and secure-context guidance, without attempting the later Android shell.

Use the current `use-event-source.ts` reconnect conventions and mirror `use-terminal.ts` backoff behavior for agent WebSockets.

UI manual checks:

- text prompt and tap response work without audio keys;
- PTT displays listening/transcribing/thinking/speaking states;
- clips play in order and stop/repeat work;
- background notice is spoken only for non-focused sessions;
- mobile layout works at the existing 768px breakpoint and on Android Chrome.

## Phase 8 — Integration, hardening, and rollout

### Verification layers

1. The focused unit tests listed in the test strategy above.
2. The four minimal integration tests listed above:
   - database/schema plus pg-boss smoke;
   - idempotent ingest;
   - fake-Claude agent tracer bullet;
   - event replay/API boundary.
3. Existing regression checks:
   - `bun run type-check` (known pre-existing failures are tracked in the handoff);
   - `pnpm build`;
   - manual terminal create/connect/write/resize/kill;
   - existing conversation and history SSE.
4. Manual voice checklist from the design:
   - each speech mode;
   - permission by voice and tap, including `always`;
   - AskUserQuestion answer;
   - non-focused completion notification;
   - stop/repeat;
   - restart and resume;
   - `claude --resume <id>` continuation;
   - Whisper/ElevenLabs failure behavior;
   - no API key leakage into browser, hook response, logs, or PTY.

### Security and operations

- authenticate/authorize routes if the deployment has auth; at minimum protect hook routes and the public server URL;
- require HTTPS for phone use;
- validate upload size/type and store outside static web root;
- redact provider keys, audio paths where sensitive, prompts, and transcripts from logs;
- use generated IDs for filesystem names;
- prevent arbitrary repo path access beyond the current allowed path policy;
- add health checks for DB and pg-boss;
- add graceful shutdown ordering: stop accepting new agent work, stop workers, kill/close live PTYs according to existing behavior, close WebSockets, close DB pool;
- document subscription billing assumptions and assert no `ANTHROPIC_API_KEY` in the interactive agent environment.

## Incremental vertical-slice implementation plan

Implement one demonstrable behavior at a time. Each slice must include the smallest production change, its focused unit tests, the relevant integration test if applicable, documentation updates, and verification before the next slice begins. Do not implement all database tables, routes, workers, or UI components horizontally before exercising an end-to-end path.

### Slice 0 — Contract and execution baseline

Confirm the Claude CLI version, hook payload/response contract, Node/pnpm versions, PostgreSQL availability, and migration command. Add the test runner and minimal test scripts only if they are not already present. Add a `docs/plans/2026-09-10-voice-agent-sessions-handoff.md` handoff with the baseline and unresolved assumptions.

Done when the external contracts are recorded, the project still builds, and a trivial test can run.

### Slice 1 — Database schema and pg-boss lifecycle

Use `/Applications/Postgres.app` as the local PostgreSQL client source. The Docker daemon is not a prerequisite for this slice; use a running Postgres.app server or defer only the DB execution test while continuing unit work.

Add configuration, the `claude_run`/`pgboss` schema bootstrap, the Drizzle client, the first migration, typed queue definitions, pg-boss startup/shutdown, and worker registration. Implement only the tables needed for the first ingest path: conversations, messages, and the minimum job metadata.

Write the database/queue smoke integration test before implementation. It must apply migrations, verify schema isolation, enqueue a job, execute a worker, assert persistence, and shut down cleanly. Add unit tests for configuration validation and queue payload/retry definitions.

### Slice 2 — One idempotent JSONL ingest path

Implement the parser and repository operation for one Claude JSONL file. Cover conversation/message upserts and malformed/incomplete lines. Add the ingest worker and enqueue it from the existing watcher without changing existing file-based reads or SSE behavior.

Write the idempotent-ingest integration test: process one fixture twice and assert no duplicate rows. Unit-test JSONL normalization, usage extraction, cost calculation, and singleton-key construction.

### Slice 3 — PTY options and fake driver

Extend `pty-manager.ts` with optional args/environment/session metadata while preserving current call sites. Add the `AgentDriver` interface and a fake driver. Implement the pure state machine and event sequence helpers before adding the real Claude process.

Unit-test argument/environment construction, removal of `ANTHROPIC_API_KEY`, state transitions, prompt queueing, timeout fallback, and replay filtering. Run the existing terminal regression path and build.

### Slice 4 — SDK/API driver, one cost-bounded text turn

Verify the current Agent SDK/API package and implement `SdkDriver` for one text turn before building the PTY hook path. Support model selection, bounded context, max output tokens, abort signal, usage capture, per-session budget checks, and structured assistant/tool/result events. Fail closed if usage or budget state is unknown.

Add a fake SDK client test for one streamed turn, usage/cost recording, budget refusal, and cancellation. Add a manual provider contract check only after the package/API and billing assumptions are recorded.

### Slice 5 — Real PTY hook driver, one text turn

Install the minimal idempotent hook configuration, add the hook endpoint, start a real interactive `claude` PTY, discover the Claude session ID, tail its transcript, and normalize one user/assistant turn. Keep permission/question handling in degraded/raw-terminal mode until the basic turn is stable.

Add the fake-Claude tracer-bullet integration test: start through `PtyHookDriver`, assert resume args and environment sanitization, emit `SessionStart` and one turn, persist ordered events, and exit cleanly. Unit-test hook parsing and safe response envelopes.

### Slice 6 — Permission and question responses

Add pending prompts, authenticated hook callbacks, `PreToolUse`/`PermissionRequest` response mapping, `AskUserQuestion` answer handling, timeout behavior, and exactly-once resolution. Support tap/text responses before voice responses.

Extend the tracer-bullet test with one permission callback. Unit-test the current Claude hook envelope and all safe fallback paths. Do not proceed until duplicate, late, and unknown callbacks are harmless.

### Slice 7 — Agent manager and text-only API

Add the live-session manager, persistence of agent sessions/events, create/resume/prompt/interrupt/kill routes, and event replay over WebSocket. Add the minimum text UI needed to create and use an agent while retaining the existing terminal UI.

Add the replay/API boundary integration test. Unit-test manager state transitions, event sequencing, and pending-prompt resolution. Verify existing terminal routes and conversation browsing remain unchanged.

### Slice 8 — Speech policy and outbound audio

Implement speech modes, sentence/code/tool chunking, TTS provider interface, one provider adapter, audio storage, TTS worker, ordered audio events, stop/repeat, and global notices. Text events must remain functional when TTS fails.

Unit-test speech policy, chunk ordering, audio path safety, and provider failure classification. Keep provider calls manual/contract-tested; do not add a live provider integration test.

### Slice 9 — Inbound PTT/STT and intent handling

Add browser MediaRecorder PTT, bounded upload handling, audio persistence, STT worker, transcript echo, exact command parsing, session switching, and spoken/tap answers. Add the mobile agent view and raw-terminal fallback.

Unit-test intent parsing and deterministic session matching. Verify voice manually on a secure context; no automated browser/audio integration test is required.

### Slice 10 — Restart/resume, cleanup, and hardening

Add startup ingest, resumable session rows, audio cleanup, health checks, graceful shutdown, redaction, upload limits, and the final manual checklist. Run all four minimal integration tests, unit tests, `bun run type-check` (recording the known baseline failures), and `pnpm build`.

### Slice completion checklist

For every slice:

1. Re-read only the files and reference implementation needed for that slice.
2. Write the focused test first and run it to confirm the expected failure where production behavior is new.
3. Implement the smallest vertical change.
4. Run the focused test, then the relevant unit/integration subset.
5. Run `bun run type-check` and record known baseline failures; run `pnpm build` at the stated phase boundaries or whenever entrypoints/dependencies change.
6. Review the diff and `git status`; do not commit, push, or modify unrelated working-tree changes.
7. Update the handoff file before ending the session.

## Session and handoff protocol

Use a new session when any of these is true:

- a slice is complete and verified;
- the current context is roughly half consumed by implementation details, tool output, or debugging;
- the next slice crosses a boundary (database → PTY, PTY → hooks, backend → UI, or local → external provider);
- a failing test or external contract needs investigation separate from the current implementation;
- the handoff would otherwise require omitting exact commands, failures, or assumptions.

Do not start a new session merely between tiny edits inside one slice. Finish the current red/green/refactor loop, verify the slice, and write the handoff first.

The durable handoff is:

`docs/plans/2026-09-10-voice-agent-sessions-handoff.md`

After every slice, update it with:

- current slice and next slice;
- completed behavior and exact files changed;
- tests added and exact commands/results;
- build/type-check status;
- migration/database/worker state;
- external contract assumptions verified or unresolved;
- known failures, blockers, and their reproduction commands;
- unrelated pre-existing working-tree changes;
- the precise first step for the next session.

Keep the handoff factual and short enough to read at the start of a new session. Never claim a test, migration, worker, CLI behavior, or external provider behavior was verified unless a tool result confirms it.

## Context-window and implementation feasibility assessment

There is sufficient context to implement this plan, provided implementation is done in vertical slices and the reference projects are re-read only when a concrete boundary is reached. The relevant architecture, design document, queue/worker patterns, Claude process patterns, and multi-schema database patterns have already been inspected. The existing `claude-run` files are small enough to modify incrementally without loading the entire repository into one context.

There is not enough context for a reliable one-shot implementation of the entire feature: it includes a database migration, queue lifecycle, PTY process supervision, Claude hook protocol, WebSocket replay, external STT/TTS adapters, and a responsive UI. These must be implemented and verified across multiple turns, with the plan and tests acting as durable state.

Recommended execution boundaries:

1. Foundation plus schema/queue smoke test.
2. JSONL ingest plus idempotency integration test.
3. PTY options, driver interface, and pure state/argument tests.
4. SDK/API driver plus cost/budget tests.
5. Hook installer/API plus fake-Claude tracer-bullet test.
6. Agent manager/API plus replay integration test.
7. Voice policy/providers/workers plus unit tests.
8. UI, manual voice checks, and final build/type-check.

At each boundary, re-read only the files being changed, run the focused tests, and record unresolved external-contract assumptions. If Claude CLI hook behavior or the target PostgreSQL environment differs from the documented assumptions, stop at that boundary and adjust the plan before continuing.

## Explicit non-goals

- no silent SDK/API-to-PTY fallback when billing or capabilities differ;
- no SSH-host agent sessions;
- no laptop-to-VM migration;
- no agent customization bundles;
- no Android/Kotlin shell;
- no replacement of `storage.ts` file reads with DB reads;
- no hands-free voice capture;
- no subscription/API billing redesign.

## Completion definition

The project is complete when a user can create a local SDK/API-first voice agent session within explicit cost budgets, speak a prompt, see the transcript, hear Claude's response, answer a permission/question prompt, reconnect and replay missed events, resume the session after server restart, explicitly switch to the PTY subscription path when desired, and still use every existing terminal and conversation-browser flow. The result must be backed by passing automated tests, the tracked `bun run type-check` baseline, `pnpm build`, and the manual voice checklist on the target VM/browser combination.
