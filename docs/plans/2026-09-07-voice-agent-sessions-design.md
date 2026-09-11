# Voice Agent Sessions — Design

**Date:** 2026-09-07 (rev 3 — SDK/API-first cost model)
**Status:** Approved in brainstorming; awaiting spec review
**Project:** 1 of 4 (see "Roadmap")

## Overview

Add a voice-first way to collaborate with Claude from a phone, on top of the
existing claude-run app (Vite + React frontend, Hono API, node-pty terminal
sessions). The addition is a new **agent session** type: a Claude session the
server understands as structured turns — what Claude said, what it is asking,
when it is done — instead of a raw terminal byte-stream.

Structure comes from an `AgentDriver`. The primary driver, `SdkDriver`, uses the
Claude Agent SDK/API directly so the server receives structured messages and
usage without scraping terminal output. A secondary `PtyHookDriver` runs the
normal interactive `claude` in a PTY for subscription-authenticated sessions,
CLI compatibility, and fallback behavior. Both drivers implement the same
interface and share persistence, voice, and UI code.

Speech recognition and synthesis run as cloud calls from the server. Persistence
and asynchronous work use PostgreSQL and pg-boss. All Claude Code conversations
(terminal, voice, and plain CLI) are mirrored into the database.

Terminal sessions and the existing conversation browser are not changed.

## Decisions Summary

| Decision | Choice |
|---|---|
| Stack | Keep Vite + Hono; no Next.js migration |
| Billing | SDK/API-first with explicit per-session budget controls; API usage is pay-as-you-go and must never silently exceed configured budgets. PTY sessions may use the user's Claude subscription when desired. |
| Structure source | `SdkDriver`: structured Agent SDK/API events and usage; `PtyHookDriver`: Claude Code hooks (`PreToolUse`, `Stop`, `Notification`, `UserPromptSubmit`) + JSONL transcript |
| Agent SDK | Primary driver behind the same interface. `PtyHookDriver` remains available for subscription-authenticated CLI sessions and compatibility fallback. |
| Cost policy | Minimize spend with model routing, prompt caching, bounded context, compact summaries, max-turn/token budgets, and usage-based stop conditions. Display estimated cost and budget state per session. |
| Relationship to terminal sessions | Agent sessions reuse `pty-manager.ts` to spawn; terminal UI path untouched |
| Where Claude runs for voice sessions | On the VM that hosts the app (SSH hosts stay terminal-only in this project) |
| Target client | Android Chrome as a PWA; Kotlin WebView shell later (project 4) |
| Voice input | Push-to-talk: record while held, send on release |
| STT | OpenAI Whisper API |
| TTS | ElevenLabs API |
| Spoken output | Per-session mode: `verbatim`, `summary`, `questions_only` |
| Summary mode | Use a configured low-cost SDK/API model with bounded input/output; a `claude -p` or PTY implementation is optional and must be explicitly selected because billing differs |
| Voice app commands | Yes: switch session, new session, stop, repeat |
| Background sessions | Spoken notification when a non-focused session finishes or asks something |
| Persistence | PostgreSQL, dedicated schema; pg-boss for async jobs |
| Conversation source of truth | Claude's JSONL files; mirrored into DB by an ingest job |
| Cost tracking | SDK/API usage is recorded directly when available; PTY/JSONL sessions use `usage` on assistant messages; cost is estimated from a model price table only when provider usage is unavailable |

## Roadmap (decomposition)

1. **Voice agent sessions** — this spec.
2. **Cross-device continuity** — deterministic scripts to move a session between a
   laptop's `~/.claude` and the VM's `~/.claude`, rewriting the project-path
   encoding in `~/.claude/projects/<encoded-path>/`, and/or reading from the DB.
3. **Agent customization & observability** — per-session/agent bundles of
   `.claude/` config (CLAUDE.md fragments, skills, allowed tools, MCP servers,
   settings), cost roll-ups. Because the driver is the real CLI, these work
   identically in the laptop terminal.
4. **Android shell** — Kotlin app hosting the web UI in a WebView with a
   foreground service for audio, persistent notification, and media-button
   push-to-talk. Enabled by the `VoiceIO` boundary defined here.

## Architecture

```
Phone (Android Chrome, PWA)
  │ hold button → record audio (MediaRecorder, webm/opus)
  │ release → POST /api/agents/:id/audio ─┐
  │ ◄── WS /api/agents/:id : events ───────┤
  │ ◄── SSE /api/agents/events : notices ──┤
                                           ▼
Hono API (VM)
  ├─ agent-manager.ts   live AgentSession registry, state machine, usage;
  │                     drives an AgentDriver
  ├─ drivers/
  │    ├─ agent-driver.ts      interface + event types
  │    ├─ sdk-driver.ts        primary Agent SDK/API driver; structured stream,
  │    │                       usage, budgets, permissions, and tool events
  │    └─ pty-hook-driver.ts   secondary `claude` PTY driver; consumes hooks +
  │                            JSONL stream; writes prompts and answers to PTY
  ├─ hooks.ts           POST /api/hooks/:sessionId/:event — receives hook
  │                     payloads; PreToolUse blocks until resolved
  ├─ voice.ts           STT (Whisper) + TTS (ElevenLabs); keys server-side only
  ├─ speech-policy.ts   pure: (event, mode) → what to speak, chunked by sentence
  ├─ intent.ts          pure: transcript → AppCommand | Prompt | Answer
  ├─ jobs/              pg-boss workers: stt, tts, summarize, notify, ingest
  ├─ db/                pg client, migrations, queries (dedicated schema)
  ├─ watcher.ts         + enqueue `ingest`; + per-session JSONL tail for agents
  └─ server.ts          new routes (below)
                                           │
                                           ▼
node-pty → interactive `claude` (subscription) → hooks → our server
                                            └→ ~/.claude/projects/*.jsonl
scripts/claude-run-hook.sh  (installed into the repo's .claude/settings.local.json
                             or user settings by the app, per session)
```

Principles:

- **Agent sessions are additive.** They appear in the sessions list tagged
  `type: "agent"` next to terminal sessions. The terminal UI path is untouched;
  `pty-manager.ts` gains only an option to inject env vars and a session tag.
- **All speech processing is server-side.** The phone uploads audio and receives
  text events plus URLs of TTS clips. No third-party API key reaches the browser.
- **The driver boundary is the future-proofing.** `agent-manager.ts`, the voice
  pipeline, DB, jobs and UI never touch the PTY, hooks, or SDK directly.
- **One WebSocket per open session** (same reconnect/backoff pattern as
  `use-terminal.ts`), plus **one global SSE stream** for cross-session
  notifications (same pattern as `use-event-source.ts`).
- **Pure decision logic is isolated** (`speech-policy.ts`, `intent.ts`) so it
  can be unit-tested without audio, network, or Claude.

## Cost-optimized Claude execution

The default voice path is the Claude Agent SDK/API, not an interactive Claude Code
PTY. This is both the main cost-control opportunity and the main architectural
risk: the API gives structured events and usage directly, but API billing is
metered and the SDK's authentication/billing behavior must be verified for the
chosen account. The application must never assume that a subscription login,
Agent SDK credential, and API key have equivalent billing.

### Cost controls required before enabling production voice sessions

- Select the model per turn: use the configured capable model for implementation
  work and a cheaper model for intent confirmation, summaries, acknowledgements,
  and notifications.
- Bound input context: send only the current turn and a compact persisted summary
  plus the minimum tool/session context; do not resend the whole transcript by
  default.
- Use prompt caching where supported and measure cache-read versus cache-write
  tokens separately.
- Set per-request max output tokens, per-session token/USD budgets, and a global
  daily/monthly budget. Refuse or downgrade work when a budget is exhausted.
- Stop on repeated no-progress turns, excessive tool loops, idle timeouts, and
  explicit user interruption.
- Keep voice output cheap: deterministic local filtering first, short summaries
  second, and a small summary model only when the selected speech mode requires
  it. Do not call an LLM for sentence splitting or command matching.
- Record provider, model, input/output/cache tokens, estimated cost, budget
  decision, and fallback reason for every turn. Do not estimate cost from text
  length when provider usage is available.
- Make fallback explicit: switching from `SdkDriver` to `PtyHookDriver` changes
  billing and must be visible in the session state/UI. Never silently attach an
  API key to the PTY.

### SDK/API driver contract

`SdkDriver` owns the Agent SDK/API request lifecycle and emits the common
`DriverEvent` stream. It must support `cwd`, resume/session identity where the
SDK provides it, `permissionMode`, `canUseTool`/permission callbacks, model,
allowed tools, max output tokens, abort signal, and usage/result messages.
Configure settings/CLAUDE.md loading explicitly (`settingSources` or the
SDK-equivalent) rather than assuming CLI defaults. If the SDK cannot preserve
required Claude Code semantics, surface that limitation and offer the PTY
fallback instead of silently changing behavior.

Before implementation, verify current SDK package/API names, authentication
modes, session resume semantics, usage fields, tool/permission callbacks, and
billing behavior from the official SDK/API documentation and the selected
account. Treat the June 15, 2026 support article update as a warning that its
previous monthly-credit description may be paused; do not build a budget policy
on that article alone.

## Agent Driver

```ts
interface AgentDriver {
  start(opts: { repo: string; resume?: string; acceptEdits: boolean }): Promise<{ sessionId: string }>;
  sendPrompt(text: string): Promise<void>;
  resolvePermission(promptId: string, r: { allow: boolean; always?: boolean }): Promise<void>;
  answerQuestion(promptId: string, answer: string): Promise<void>;
  interrupt(): Promise<void>;   // Esc — stop the current turn
  kill(): Promise<void>;
  on(event: DriverEvent, cb): void;
}

type DriverEvent =
  | "session_id"          // { sessionId }  as soon as known
  | "assistant_text"      // { delta }      streamed from JSONL
  | "tool_use"            // { tool, input }
  | "tool_result"         // { tool, summary }
  | "permission_request"  // { promptId, tool, input }
  | "question"            // { promptId, question, options? }
  | "turn_complete"       // { usage }
  | "exit";               // { code }
```

### `PtyHookDriver`

**Spawn.** Uses `pty-manager.createSession(repo, "local", { env })` with
`CLAUDE_RUN_SESSION=<internal id>` and `CLAUDE_RUN_HOOK_URL=<server>`; resume
adds `--resume <sessionId>`. Before spawning, the driver ensures the hook
configuration is present (see "Hook installation").

**Structure sources.**

| Need | Source |
|---|---|
| Session id | `SessionStart` hook payload (`session_id`, `transcript_path`); fallback: newest JSONL in the project dir after spawn |
| Assistant text, tool_use, tool_result, usage | Tail of the session's JSONL (chokidar, same reader as `storage.ts`); emitted incrementally |
| Permission request | `PreToolUse` hook. The hook script POSTs to `/api/hooks/:id/pre-tool-use` and **blocks** until the server responds; the response body is the hook JSON decision (`permissionDecision: "allow" \| "deny"`, or `"ask"` to fall through to the TUI). Timeout configured well above the default (e.g. 10 min) so a slow human answer never times out |
| Question (`AskUserQuestion`) | `PreToolUse` on that tool → emit `question`; the driver types the spoken answer into the PTY when the TUI shows the prompt, or `interrupt()` then `sendPrompt(answer)` as fallback |
| Turn complete | `Stop` hook (POST, non-blocking) |
| Waiting/idle | `Notification` hook (non-blocking); used to sanity-check state |
| Exit | PTY exit |

**Prompts** are written to the PTY as text + `\r`. Before sending, the driver
requires state `idle`; otherwise the prompt is queued.

**Permission allow-list** (`always`) is tracked in the driver and answered
server-side without emitting an event; `acceptEdits` is passed as
`--permission-mode acceptEdits`.

### Hook installation

The app manages a JSON fragment in `~/.claude/settings.json` (user scope, so it
applies to every repo) that registers `scripts/claude-run-hook.sh` for
`SessionStart`, `PreToolUse`, `Stop`, `Notification`. The script is a no-op when
`CLAUDE_RUN_SESSION` is unset, so laptop/CLI sessions are unaffected. Installation
is idempotent and shown in the UI (settings panel: "Hooks installed ✓"). The exact
settings keys and hook payload/response formats are verified against current
Claude Code docs during planning (see Handoff).

### `SdkDriver` (primary)

The initial implementation uses the current TypeScript Agent SDK/API contract.
The expected mapping is: query/request with `cwd` and optional resume/session
identity; permission callback → `permission_request`; `AskUserQuestion` →
`question`; assistant/tool stream messages → common events; result message →
`turn_complete` with provider usage. Configure
`settingSources: ["user", "project", "local"]` or the current equivalent so
CLAUDE.md, skills, and MCP configuration are intentionally loaded.

The exact package, method names, resume support, authentication mode, usage
fields, and billing must be verified before coding. API-key execution is
pay-as-you-go and must be guarded by the budget controls above. If subscription
authentication is available through the SDK, it must still be verified rather
than assumed. `SdkDriver` must fail closed when a budget or provider limit is
unknown.

## Agent Session Model

```ts
type AgentState =
  | "idle" | "thinking" | "awaiting_permission" | "awaiting_answer" | "ended";

interface PendingPrompt {
  kind: "permission" | "question";
  id: string;
  tool?: string; input?: unknown;
  question?: string; options?: string[];
}

interface AgentSession {
  id: string;              // Claude session id — what `claude --resume` accepts
  internalId: string;      // ours, known before Claude reports its id
  repo: string;
  name: string;            // repo basename unless renamed
  createdAt: number;
  state: AgentState;
  speechMode: "verbatim" | "summary" | "questions_only";
  acceptEdits: boolean;
  pending?: PendingPrompt;
  usage: { inputTokens; outputTokens; cacheRead; costUsd; turns };
  clients: Set<WebSocketLike>;
  playback: { queue: string[]; lastClipUrl?: string };
  driver: AgentDriver;
}
```

### Lifecycle and routes

| Route | Effect |
|---|---|
| `POST /api/agents { repo, resume? }` | create session, driver.start |
| `GET /api/agents` | list live + recent (from DB) agent sessions |
| `WS /api/agents/:id` | events; replays `agent_events` since client's last `seq` |
| `POST /api/agents/:id/audio` | upload PTT recording → `stt` job |
| `POST /api/agents/:id/prompt { text }` | text prompt (desktop use, tests) |
| `POST /api/agents/:id/respond { promptId, allow?, always?, answer? }` | resolve pending prompt (voice and tap both use this) |
| `POST /api/agents/:id/interrupt` | Esc |
| `PATCH /api/agents/:id { speechMode?, acceptEdits?, name? }` | settings |
| `DELETE /api/agents/:id` | kill |
| `POST /api/hooks/:internalId/:event` | hook callbacks (localhost only) |
| `GET /api/agents/events` | global SSE notices |

On server restart, live sessions are lost but rows remain; **Resume** restarts
the driver with the stored Claude session id.

### State machine

`permission_request` → `awaiting_permission`; `question` → `awaiting_answer`;
`respond` → `thinking`; `turn_complete` → `idle` (+ usage); `exit` → `ended`.
Every transition emits an `AgentEvent` on the session WebSocket **and** a
`SessionNotice` on the global SSE stream.

### Client events

`assistant_text`, `tool_use`, `tool_result`, `permission_request`, `question`,
`turn_complete`, `state`, `audio { clipUrl, text, kind }`, `error` — unchanged
from rev 1.

## Voice Pipeline

### Inbound

1. Phone records while the PTT button is held, uploads on release.
2. Route stores the audio, enqueues **`stt`**, returns `202`.
3. `stt` worker → Whisper → transcript → `intent.ts`:
   - **App command** (`switch to <name>`, `new session in <repo>`, `stop`,
     `repeat`): executed; short spoken acknowledgement.
   - **Answer** when state is `awaiting_*`: yes/allow/always/no/deny or free
     text → `/respond`.
   - **Prompt** otherwise → `driver.sendPrompt` (queued if `thinking`).
4. Transcript echoed to the client as the user message.

### Outbound

1. `assistant_text` deltas are chunked at sentence boundaries by
   `speech-policy.ts` per mode: `verbatim` (code blocks → "code block, N lines";
   tools → one line), `summary` (held until `turn_complete`, then **`summarize`**
   job, ≤ 2 sentences), `questions_only` (only prompts and "done").
2. Each chunk → **`tts`** job → ElevenLabs → clip on disk + `audio_clips` row →
   `audio` event.
3. Client plays clips in order; `stop` clears the queue; `repeat` replays the
   last clip.
4. Permission requests and questions are always spoken.

### Cross-session notifications

A notice for a **non-focused** session on `turn_complete`, `permission_request`
or `question` enqueues **`notify`** → TTS "<name> is done" / "<name> needs
input" → global SSE `audio` event, played after the current clip.

## UI (mobile-first)

`agent-session-view.tsx`: transcript (reusing `message-block.tsx` renderers);
bottom bar with PTT button, state pill (*listening · transcribing · thinking ·
waiting for you · speaking*), settings sheet (speech mode, acceptEdits, rename);
prompt card with **Allow / Deny / Always** or option buttons; header with cost
and tokens. A collapsible raw terminal panel (existing `terminal-panel.tsx`) is
available for the rare case the TUI needs a keystroke — same PTY, so nothing
extra to wire. Sessions list gets a type badge and state dot; the new-session
modal gets a Voice/Terminal choice (voice = local host only).

### `VoiceIO` boundary

```ts
interface VoiceIO {
  startCapture(): Promise<void>;
  stopCapture(): Promise<Blob>;
  play(url: string): Promise<void>;
  stop(): void;
  onInterrupted?(cb: () => void): void;
}
```
PWA implementation: `MediaRecorder` + `HTMLAudioElement`. The Kotlin shell
injects its own via a JS bridge.

## Persistence

Dedicated schema (name and migration style to match the provided examples;
working name `claude_run`).

| Table | Purpose | Key columns |
|---|---|---|
| `conversations` | one per Claude session id, any origin | `id`, `project_path`, `origin` (`terminal`/`agent`/`cli`), `first_seen`, `last_seen`, `display_text` |
| `messages` | mirror of every JSONL message line | `uuid` (unique), `conversation_id`, `role`, `content jsonb`, `usage jsonb`, `ts`, `parent_uuid` |
| `agent_sessions` | agent-specific state | `id` (= conversation id, nullable until known), `internal_id`, `repo`, `name`, `speech_mode`, `accept_edits`, `state`, `driver`, `created_at`, `ended_at` |
| `agent_events` | synchronous event log for replay/audit | `id`, `session_id`, `seq`, `type`, `payload jsonb`, `ts` |
| `pending_prompts` | durable copy of open prompts | `id`, `session_id`, `kind`, `payload jsonb`, `resolved_at`, `response jsonb` |
| `usage_turns` | one row per assistant turn | `session_id`, `turn`, `model`, `input_tokens`, `output_tokens`, `cache_read`, `cost_usd`, `ts` |
| `audio_clips` | TTS and uploads | `id`, `session_id`, `kind`, `path`, `text`, `duration_ms`, `ts` |
| `model_prices` | price table for cost estimation | `model`, `input_per_mtok`, `output_per_mtok`, `cache_read_per_mtok`, `valid_from` |

Audio bytes live under `AUDIO_DIR`; a daily pg-boss schedule prunes clips older
than `AUDIO_RETENTION_DAYS`.

### Conversation ingest

`watcher.ts` enqueues an **`ingest`** job per changed JSONL (singleton key =
path, debounced 1 s). The worker parses with the existing `storage.ts` reader
and upserts `conversations` and `messages` on `uuid`. Idempotent; covers
terminal, agent and plain CLI sessions on the VM. `usage_turns` is derived here
from assistant-message `usage` fields, so cost tracking works for every session
type, not just voice. Existing file-based reads in `storage.ts` stay.

### pg-boss queues

| Queue | Retry | Notes |
|---|---|---|
| `stt` | 2, backoff | final failure → spoken "I didn't catch that" |
| `tts` | 2, backoff | final failure → text still shown; never blocks the turn |
| `summarize` | 1 | failure → first two sentences verbatim |
| `notify` | 1 | best-effort |
| `ingest` | 3, singleton per path | debounced |

Workers run in the Hono process for now.

## Configuration

`DATABASE_URL`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
`SUMMARY_BACKEND` (`claude-p` | `api`), `ANTHROPIC_API_KEY` (only if
`SUMMARY_BACKEND=api`; **never exported into the `claude` PTY environment**),
`AUDIO_DIR`, `AUDIO_RETENTION_DAYS` (7), `HOOK_TIMEOUT_S` (600),
`CLAUDE_RUN_PUBLIC_URL`. Claude Code on the VM must be logged in with the
subscription (`claude` → `/login`), and the PTY env must not contain
`ANTHROPIC_API_KEY`; the driver asserts this at spawn.

## Error Handling

| Scenario | Behavior |
|---|---|
| Hook not installed / not firing | session starts in `degraded` mode: JSONL-only, permissions fall to the TUI, banner "Install hooks" |
| Hook POST arrives for unknown session | 404; script exits 0 (no-op) |
| PreToolUse waits past `HOOK_TIMEOUT_S` | script returns `ask` → TUI prompt; terminal panel opens |
| Whisper fails after retries | spoken + shown "didn't catch that"; nothing sent |
| ElevenLabs fails | text shown, audio skipped; one toast per session |
| Summary fails | first two sentences verbatim |
| `claude` exits mid-turn | `ended`; card offers **Resume** (same id) |
| WebSocket drops | backoff reconnect; replay `agent_events` from last `seq` |
| Upload while `thinking` | queued; pill shows "queued" |
| Audio focus lost | `VoiceIO.onInterrupted` pauses; resumes on tap |
| DB unavailable at startup | server refuses to start |

## Testing

- **Unit (pure):** `intent.ts`, `speech-policy.ts`, JSONL → `messages`/`usage_turns`
  mapping, hook payload parsing.
- **Integration:** `agent-manager` state machine against a `FakeDriver`
  (permission → respond → idle; question → answer; exit → ended); `PtyHookDriver`
  against a fake `claude` script that emits hook calls and writes a JSONL;
  pg-boss workers on a test DB; replay-after-reconnect.
- **Manual voice checklist:** PTT round-trip in each mode; spoken permission
  answered by voice and by tap; `always`; background notice; `stop`/`repeat`;
  resume after restart; `claude --resume <id>` in a terminal continues a voice
  session and vice versa.

## File Structure

```
api/
├── agent-manager.ts
├── drivers/{agent-driver.ts, pty-hook-driver.ts, sdk-driver.ts}
├── hooks.ts
├── voice.ts, speech-policy.ts, intent.ts
├── jobs/{stt,tts,summarize,notify,ingest}.ts, jobs/index.ts
├── db/{client.ts, queries.ts, migrations/*.sql}
├── pty-manager.ts    (+ env injection, session tag)
├── watcher.ts        (+ ingest enqueue, per-session tail)
└── server.ts         (+ /api/agents, /api/hooks routes)
scripts/claude-run-hook.sh
web/
├── components/{agent-session-view,prompt-card,ptt-button}.tsx
├── hooks/{use-agent-session,use-session-notices}.ts
├── voice/{voice-io.ts, media-recorder-voice-io.ts}
└── app.tsx           (+ session type routing)
```

## Out of Scope (this project)

agent sessions on SSH hosts; hands-free capture;
laptop↔VM migration (project 2); agent bundles/customization (project 3);
Android shell (project 4); replacing `storage.ts` reads with DB queries.

## Handoff — Context for the Next Claude Code Session

Read this first, then the rest of the spec.

### Where this came from

- Produced with the `superpowers:brainstorming` skill (github.com/obra/superpowers),
  architectural path. Every decision in "Decisions Summary" was made explicitly by
  Bogdan; do not reopen them unless he asks. Next step per that skill is
  `superpowers:writing-plans` — after Bogdan approves this spec.
- Rev 1 chose the Agent SDK. Rev 2 switched to interactive `claude` + hooks
  because of billing assumptions. Rev 3 restores the SDK/API as the primary
  driver because structured API usage is the main cost-optimization path; the
  billing and authentication assumptions must be verified before implementation.
- Repo: `bogdansolga/claude-run`, fork of `kamranahmedse/claude-run`. Read
  `CLAUDE.md` and `docs/plans/2025-01-03-interactive-sessions-design.md`.

### Billing model and cost decision

- The default `SdkDriver`/API path is metered pay-as-you-go unless the selected
  SDK authentication mode explicitly provides another allowance. Budget limits,
  model routing, bounded context, and usage-based stop conditions are therefore
  mandatory—not optional optimization.
- The `PtyHookDriver` path uses the interactive Claude Code subscription when
  logged in without an API key. It is retained as an explicit alternative, not
  a silent fallback.
- Current support documentation says the previously described June 15, 2026
  Agent SDK monthly-credit change is paused. Treat that page as historical
  context; verify current account billing in the official SDK/API documentation
  and account before selecting a production default.
- Any `ANTHROPIC_API_KEY` in the PTY environment can cause per-token billing.
  Keep it out of the PTY environment and assert this at spawn.

### The Agent SDK *is* Claude Code

Same engine, same `~/.claude/projects/<encoded-cwd>/*.jsonl` session store, same
session ids. That is why laptop↔phone continuity is `claude --resume <id>` on the
same machine, and why `SdkDriver` can be added later with identical semantics.
The SDK does **not** load `CLAUDE.md`/settings/skills unless `settingSources` is
set — relevant only when `SdkDriver` is built.

### Current environment (as described by Bogdan)

- Today: Termux (SSH) from an Android phone into a Raspberry Pi ("PiNAS",
  192.168.1.31) or a Mac Studio (192.168.1.5). `scripts/deploy/deploy.sh`
  targets the Pi.
- New app will run in a **VM** (details not yet given). Ask before assuming.
- Laptop workflow mixes local Claude Code (own `~/.claude`) and the web app;
  migration between them is project 2. Two Kotlin starter apps exist for project 4.

### Inputs still owed by Bogdan

1. PostgreSQL multi-schema example (schema naming, migrations, client).
2. pg-boss example (queue naming, job options, worker registration).
3. VM description: OS, whether target repos are checked out on it (assumed
   yes), how the phone reaches it (LAN / Tailscale / reverse proxy). Affects
   TLS — `MediaRecorder` needs a secure context — and PWA install.
4. Confirmation `claude` on the VM is logged in with the subscription.

### Verify before planning (against current Claude Code docs)

- Hook event names and payloads for `SessionStart`, `PreToolUse`, `Stop`,
  `Notification`; the JSON response shape for a blocking `PreToolUse` decision
  (`permissionDecision` allow/deny/ask) and how to set a per-hook timeout.
- Whether `AskUserQuestion` can be intercepted or answered through a hook; if
  not, the PTY-typing fallback stands.
- `--permission-mode acceptEdits` and `--resume` flags on the interactive CLI.
- JSONL line format for assistant `usage` and `model` fields (for `usage_turns`).
- Settings file location/scope for user-level hooks (`~/.claude/settings.json`).

### Open refinements (decide during planning)

- Phrase set for `intent.ts`; fuzzy-match session names.
- Whether `summary` mode also speaks tool activity.
- Sentence-chunk size vs number of TTS calls.
- Whether the hook script should be Node (portable) or shell.
- Moving workers to a separate process once load warrants it.

### Suggested order of work

1. DB + pg-boss foundation and the `ingest` job with `usage_turns` (valuable
   alone; unblocks projects 2 and 3).
2. Hook script + `hooks.ts` + `PtyHookDriver` with a fake-`claude` test;
   `agent-manager` state machine on `FakeDriver`.
3. Text-only agent UI: type prompts, see events, answer permission cards by tap.
4. Outbound voice (`speech-policy` + `tts`), then inbound (`stt` + `intent`).
5. Global notices, `stop`/`repeat`, speech-mode settings.
6. PWA manifest, secure context, manual voice checklist.
