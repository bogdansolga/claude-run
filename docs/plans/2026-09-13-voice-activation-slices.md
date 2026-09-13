# Voice-Activated Usage — Incremental Slice Plan

**Date:** 2026-09-13
**Parent design:** `docs/plans/2026-09-07-voice-agent-sessions-design.md`
**Implementation plan:** `docs/plans/2026-09-10-voice-agent-sessions-implementation.md`
**Status:** Ready for implementation

## Goal

Add voice-activated Claude usage with both directions of communication while preserving the existing terminal and conversation-browser behavior:

- inbound: push-to-talk audio becomes a transcript, command, answer, or Claude prompt;
- outbound: Claude events become text, speech-policy chunks, and ordered audio playback;
- text remains functional when audio providers fail or are not configured.

The implementation must be built as vertical slices. Each slice has a focused test, a user-visible or operational acceptance boundary, a verification command, and a commit before the next boundary.

## Current baseline

Completed and available:

- `AgentDriver` interface and `FakeAgentDriver`.
- Agent state transition helpers and PTY launch options.
- Existing terminal sessions and conversation browser.
- PostgreSQL/pg-boss foundation and JSONL ingestion.
- Per-session/per-day API-equivalent usage tracking.
- Multi-root discovery of `~/.claude` and `~/.claude-nix`.
- Subscription/accounting limitations documented; no fabricated subscription discount.

Not yet implemented:

- live agent manager;
- agent WebSocket/event replay;
- audio upload/storage;
- STT/TTS provider boundaries or adapters;
- speech policy and intent parsing;
- agent UI or PTT controls;
- real SDK/PTY agent drivers wired into an agent session.

## Prerequisites and guardrails

### Repository and runtime

- Re-read the relevant files before each slice; preserve unrelated working-tree changes.
- Use Bun for focused tests and type-checking; use the project build command at UI/entrypoint boundaries.
- Keep the dev server stopped unless a slice requires manual browser verification.
- Do not modify or commit credentials, `.env` files, provider keys, uploaded audio, or generated runtime state.
- Keep existing terminal routes, PTY behavior, conversation reads, and SSE behavior compatible.

### External contracts

Before using a real provider or Claude process:

- Verify the installed Claude CLI/Agent SDK contract, authentication, billing, resume, permissions, usage, abort, and structured event behavior.
- Keep SDK/API billing distinct from subscription-authenticated PTY billing.
- Verify Whisper and ElevenLabs request/response formats, limits, timeouts, and error behavior before writing adapters.
- Do not require live provider credentials for unit tests.
- Use fake providers and a fake Claude process for automated integration tests.

### Security and resource controls

- Keep provider keys server-side.
- Validate agent IDs, repository paths, upload content types, and upload sizes.
- Store audio outside the static web root under generated IDs.
- Add bounded timeouts and retry classification at provider boundaries.
- Redact keys, audio contents, prompts, and full transcripts from logs.
- Enforce agent cancellation and eventual cleanup.
- Do not silently switch between SDK/API and PTY drivers because of billing or capability differences.

### Slice discipline

For every slice:

1. Inspect the target symbols and current status.
2. Write focused tests first and run them RED when behavior is new.
3. Implement the smallest vertical change.
4. Run focused tests, relevant suite, type-check, and build when applicable.
5. Perform manual runtime verification for browser/process boundaries.
6. Update the handoff with exact results and blockers.
7. Commit only the verified slice with an explicit scope.

## Slice sequence

### Slice 1 — Text-only agent manager

**Purpose:** establish the control plane used by both inbound and outbound voice.

**Implementation:**

- Add `api/agent-manager.ts`.
- Own live agent sessions and driver callbacks.
- Create, prompt, interrupt, and kill operations.
- Map internal agent ID to driver and Claude session ID.
- Normalize driver events into a session event stream.
- Start with `FakeAgentDriver` only.
- Keep events in memory initially; persistence is a later slice.

**Routes:**

- `POST /api/agents`
- `GET /api/agents`
- `POST /api/agents/:id/prompt`
- `POST /api/agents/:id/interrupt`
- `DELETE /api/agents/:id`

**Tests:**

- lifecycle and state transitions;
- prompt forwarding;
- interrupt/kill behavior;
- unknown and ended session handling;
- driver event forwarding.

**Acceptance:** a text client can create a fake agent, send a prompt, receive assistant events, interrupt it, and kill it. Existing terminal routes pass unchanged.

**Commit:** `Add text agent session manager`

### Slice 2 — Agent WebSocket transport and replay

**Purpose:** deliver ordered agent events to the browser before adding audio.

**Implementation:**

- Add `WS /api/agents/:id`.
- Add monotonically increasing per-session event sequence numbers.
- Support `since`/last-sequence replay.
- Add reconnect and duplicate suppression semantics.
- Add a minimal diagnostic client or hook if needed for verification.

**Tests:**

- event ordering;
- replay returns only missing events;
- reconnect does not duplicate events;
- unknown agent and malformed `since` handling.

**Acceptance:** a browser/client receives fake-agent events and can reconnect without losing or duplicating events.

**Commit:** `Add agent event WebSocket transport`

### Slice 3 — Outbound speech policy with fake TTS

**Purpose:** decide what Claude output should be spoken without depending on a provider.

**Implementation:**

- Add `api/speech-policy.ts`.
- Add `api/voice/types.ts` provider interfaces.
- Implement `verbatim`, `summary`, and `questions_only` modes.
- Sentence chunking with stable chunk IDs and order.
- Code blocks become a short description/count.
- Tool use/results become one-line summaries.
- Questions and permission requests are always speakable.
- Add deterministic fake TTS provider and failure mode.

**Tests:**

- mode filtering;
- sentence and code-block chunking;
- tool/question/permission handling;
- stable ordering;
- fake TTS success and failure.

**Acceptance:** text events remain available when speech is disabled or fake TTS fails; speech chunks are deterministic and ordered.

**Commit:** `Add outbound speech policy and fake TTS`

### Slice 4 — Outbound audio delivery and playback

**Purpose:** complete Claude-to-user delivery with generated/fake audio.

**Implementation:**

- Add audio clip storage abstraction using generated IDs.
- Add audio event payloads to the agent event stream.
- Add ordered browser audio queue.
- Add stop and repeat operations.
- Add the smallest agent view needed to show transcript and playback state.
- Keep text event delivery independent from audio delivery.

**Tests/manual checks:**

- ordered clip events;
- stop interrupts playback;
- repeat replays the last clip;
- missing/failed clip does not break text events;
- manual browser check with fake audio fixtures.

**Acceptance:** a fake agent turn produces ordered audio events and the browser plays, stops, and repeats them.

**Commit:** `Add outbound voice playback`

### Slice 5 — Inbound push-to-talk with fake STT

**Purpose:** capture and upload user speech without introducing a real provider yet.

**Implementation:**

- Add `web/voice/voice-io.ts`.
- Add `web/voice/media-recorder-voice-io.ts`.
- Add push-to-talk pointer/touch handling.
- Add `POST /api/agents/:id/audio`.
- Validate MIME type, size, and agent state.
- Store uploads outside the static web root using generated IDs.
- Add fake STT provider returning deterministic transcripts.
- Echo transcript as an event without executing it yet.

**Tests/manual checks:**

- one upload per press/release;
- cancellation and too-short recordings;
- upload validation and size limits;
- fake STT success/failure;
- manual browser state transitions: listening, uploading, transcribing, ready.

**Acceptance:** holding and releasing PTT produces one validated upload and a visible transcript.

**Commit:** `Add inbound push-to-talk pipeline`

### Slice 6 — Closed-loop fake voice turn

**Purpose:** prove inbound and outbound voice work together end to end.

**Implementation:**

- Route fake transcript to `sendPrompt`.
- Stream fake assistant events through the manager/WebSocket.
- Apply speech policy.
- Run fake TTS.
- Play the resulting audio in the browser.

**Acceptance:** `hold → release → transcript → fake agent response → ordered audio playback` works without external credentials.

**Manual check:** run the assembled local UI and verify the text transcript remains visible throughout.

**Commit:** `Complete fake voice turn`

### Slice 7 — Deterministic intent and voice commands

**Purpose:** distinguish prompts from application controls and pending answers.

**Implementation:**

- Add `api/intent.ts`.
- Exact commands: switch session, new session, stop, repeat.
- Exact permission answers: yes, allow, always, no, deny.
- Free text becomes a prompt.
- Deterministic session-name matching.
- Ambiguous names produce clarification instead of guessing.

**Tests:**

- command parsing;
- prompt fallback;
- permission answer parsing;
- session matching and ambiguity;
- commands do not invoke Claude unnecessarily.

**Acceptance:** spoken commands control the app; free text reaches the agent; ambiguous session commands are safe.

**Commit:** `Add deterministic voice commands`

### Slice 8 — Bounded real SDK agent driver

**Purpose:** replace the fake agent with one real, cost-controlled text turn.

**Prerequisites:** verified SDK contract, authentication, model/rate configuration, budget policy, abort behavior, and usage fields.

**Implementation:**

- Add `api/drivers/sdk-driver.ts` behind the existing interface.
- One bounded turn with model selection, max output, context limits, cancellation, and usage capture.
- Enforce per-session budget and fail closed if budget/usage is unknown.
- Persist/display provider, model, usage, and budget decision.

**Tests/manual checks:**

- fake SDK client stream;
- usage/cost recording;
- budget refusal;
- cancellation;
- manual provider contract check with explicit credentials only.

**Commit:** `Add bounded SDK agent driver`

### Slice 9 — PTY hook driver and subscription path

**Purpose:** support explicit subscription-authenticated Claude Code sessions.

**Prerequisites:** verified hook payloads/responses, hook installer behavior, local process security, and explicit billing display.

**Implementation:**

- Hook installer and no-op hook script.
- Hook routes with per-session authentication.
- `api/drivers/pty-hook-driver.ts`.
- SessionStart discovery and JSONL tailing.
- One text turn first; degraded permission/question handling initially.

**Tests:**

- hook payload parsing and safe responses;
- fake-Claude tracer bullet;
- resume args and environment sanitization;
- ordered events and clean exit.

**Commit:** `Add PTY hook agent driver`

### Slice 10 — Permission and question handling

**Purpose:** support interactive Claude decisions before relying on voice answers.

**Implementation:**

- Pending prompt state.
- Permission/question events.
- Tap/text response route first.
- Exactly-once resolution.
- Duplicate, late, unknown, and timeout callbacks.
- Voice answer integration after text/tap behavior is stable.

**Acceptance:** permission and question prompts can be answered safely through the UI and then by voice.

**Commit:** `Add agent permission and question handling`

### Slice 11 — Real STT and TTS adapters

**Purpose:** replace fakes with provider implementations.

**Prerequisites:** provider API contracts, server-side credentials, timeout/retry policy, upload/audio limits, and secure deployment URL.

**Implementation:**

- Whisper adapter behind STT interface.
- ElevenLabs adapter behind TTS interface.
- Keep fake adapters for tests.
- Provider failures preserve text flow and surface a recoverable status.

**Manual checks:**

- real inbound transcription;
- real outbound speech;
- provider timeout/failure;
- no key exposure in browser, logs, or events.

**Commits:**

- `Add STT provider boundary`
- `Add Whisper adapter`
- `Add TTS provider boundary`
- `Add ElevenLabs adapter`

### Slice 12 — Persistence, resume, notices, cleanup, and hardening

**Purpose:** make voice sessions durable and safe to operate.

**Implementation:**

- Persist agent sessions/events/audio metadata.
- Add replay from PostgreSQL.
- Add global SSE notices for non-focused sessions.
- Restore resumable sessions after restart without claiming PTYs are live.
- Add audio retention cleanup and health checks.
- Add graceful shutdown and final security/redaction checks.
- Run the full manual voice checklist and existing regressions.

**Commit:** `Persist and harden voice sessions`

## Verification gates

Before moving between major boundaries:

- focused tests pass;
- `bun test` passes, with database tests explicitly recorded as skipped or passed;
- `bun run type-check` passes;
- `pnpm build:web` passes after frontend slices;
- `git diff --check` passes;
- existing terminal create/connect/write/resize/kill behavior remains functional;
- the handoff records exact results, unresolved assumptions, and the next first action.

## Immediate next action

Start Slice 1 by inspecting `api/drivers/agent-driver.ts`, `api/server.ts`, existing route tests, and the current server lifecycle. Write the agent-manager lifecycle test first, run it RED, then implement the smallest fake-driver-backed manager and routes.
