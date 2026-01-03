# Interactive Sessions & UI Enhancements Design

## Overview

Enhance claude-run to support interactive Claude Code sessions via a web-based terminal, with multi-host support and responsive UI improvements.

## Decisions Summary

| Decision | Choice |
|----------|--------|
| PTY approach | node-pty with full terminal emulation |
| Repo selection | Dropdown from known projects |
| UI layout | Split view (messages above, terminal below) |
| Terminal UI | xterm.js v6 |
| Session lifecycle | Persistent with reconnect |
| Database | None (in-memory Map) |
| Conversation width | Responsive (`max-w-3xl lg:max-w-5xl xl:max-w-6xl`) |
| Multi-host | Config file + UI toggle |
| Toasts | Sonner |

## Architecture

### High-Level Flow

```
Browser                         API Server (Pi)
   │                                  │
   │ ── GET /api/projects ──────────► │  (existing - list known repos)
   │ ── GET /api/hosts ─────────────► │  (new - list configured hosts)
   │                                  │
   │ ── WS /api/terminals/new ──────► │  1. Spawn PTY (local or via SSH)
   │                                  │  2. Store in Map<sessionId, PTY>
   │ ◄─── PTY output (streamed) ───── │
   │                                  │
   │ ── user keystrokes ────────────► │  3. Write to PTY stdin
   │ ◄─── PTY output ──────────────── │
   │                                  │
   │ ── WS /api/terminals/:id ──────► │  4. Reconnect to existing PTY
```

### Multi-Host Configuration

Config file: `~/.claude-run/config.json`

```json
{
  "hosts": {
    "macstudio": {
      "label": "MacStudio",
      "type": "ssh",
      "host": "192.168.1.5",
      "user": "bogdan",
      "default": true
    },
    "local": {
      "label": "Raspberry Pi",
      "type": "local"
    }
  },
  "defaultHost": "macstudio"
}
```

**SSH Host Behavior:**
- Pi spawns: `ssh bogdan@192.168.1.5 -t "cd /path/to/repo && claude"`
- Uses `node-pty` to wrap the SSH process (preserves colors/interactivity)
- Requires passwordless SSH key auth pre-configured

**Local Host Behavior:**
- Spawns `claude` directly via `node-pty`

### Session Management

```typescript
interface TerminalSession {
  id: string;
  pty: IPty;
  repo: string;
  host: string;
  createdAt: number;
  clients: Set<WebSocket>;  // Multiple tabs can view same session
}

const sessions = new Map<string, TerminalSession>();
```

- Sessions survive tab close (PTY keeps running)
- Sessions die on server restart (acceptable for dev tool)
- Multiple browser tabs can connect to same session

## API Endpoints

```typescript
// List available hosts and their status
GET /api/hosts
→ [{ id: "macstudio", label: "MacStudio", status: "online" },
   { id: "local", label: "Raspberry Pi", status: "online" }]

// List active terminal sessions
GET /api/terminals
→ [{ id: "abc123", repo: "/path/to/project", host: "macstudio", createdAt: 1234567890 }]

// WebSocket: Create new terminal session
WS /api/terminals/new?repo=/path/to/project&host=macstudio

// WebSocket: Reconnect to existing session
WS /api/terminals/:id

// Kill a terminal session
DELETE /api/terminals/:id
```

## UI Layout

### Split View Structure

```
┌─────────────────────────────────────────────────────┐
│ [☰] Session Title          [Host: MacStudio ▼] [⋮] │  ← Header
├─────────────────────────────────────────────────────┤
│                                                     │
│  Conversation Messages                              │  ← Top section
│  (existing MessageBlock components)                 │     Scrollable
│  max-w-3xl lg:max-w-5xl xl:max-w-6xl               │     Responsive width
│                                                     │
├─────────────────────────────────────────────────────┤
│ ▼ Terminal ─────────────────────── [↕] [✕]         │  ← Drag handle
├─────────────────────────────────────────────────────┤
│ $ claude                                            │
│ ╭────────────────────────────────────────────────╮ │  ← xterm.js
│ │ Welcome to Claude Code!                        │ │     Resizable height
│ │ > What would you like to work on?              │ │
│ ╰────────────────────────────────────────────────╯ │
└─────────────────────────────────────────────────────┘
```

### Responsive Behavior

- **Desktop**: Stacked with resizable divider
- **Mobile**: Stacked, terminal can expand to full-screen
- **Terminal height**: Draggable divider or preset sizes (25%, 50%, 75%)

### New Session Flow

1. Click "New Session" button in sidebar
2. Modal appears: Select repo + Select host
3. Click "Start" → PTY spawns, terminal panel opens

## Error Handling

| Scenario | Behavior |
|----------|----------|
| SSH connection fails | Toast: "MacStudio unreachable. Switch to Pi?" |
| SSH auth failure | Show setup instructions |
| Connection drops | Auto-reconnect with exponential backoff |
| Claude exits normally | "Session ended. [Start New] [Close]" |
| User closes tab | PTY keeps running, can reconnect |
| Server restart | All PTYs lost, sessions cleared |

### Resource Limits

- Max concurrent sessions per host: configurable (default: 3)
- Session timeout: optional (default: none)

## File Structure

### New API Files

```
api/
├── pty-manager.ts      # PTY session Map, spawn/kill logic
├── hosts.ts            # Host config loading, SSH connection helpers
├── websocket.ts        # WebSocket upgrade handler for terminals
└── server.ts           # Add WS routes, hosts endpoints
```

### New Web Files

```
web/
├── components/
│   ├── terminal-panel.tsx       # xterm.js wrapper, resize handle
│   ├── new-session-modal.tsx    # Repo + host selection
│   ├── host-selector.tsx        # Dropdown with status indicators
│   └── active-sessions-list.tsx # Shows running sessions in sidebar
├── hooks/
│   └── use-terminal.ts          # WebSocket connection, xterm setup
└── app.tsx                      # Add Toaster, integrate split view
```

## Dependencies

```json
{
  "dependencies": {
    "node-pty": "^1.1.0",
    "@xterm/xterm": "^6.0.0",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-web-links": "^0.12.0",
    "sonner": "^2.0.7"
  }
}
```

## Implementation Phases

Use `superpowers:subagent-driven-development` skill for parallel implementation.

### Phase 1: Responsive Width (Quick Win)
- Update `session-view.tsx` with responsive `max-w-` classes
- Test on mobile and desktop

### Phase 2: Local PTY Foundation
- Add `node-pty` dependency
- Create `pty-manager.ts` with spawn/kill for local sessions
- Add WebSocket endpoint in `server.ts`
- Basic terminal panel with xterm.js (no split view yet)
- Test: can spawn `claude` and interact

### Phase 3: Terminal UI Integration
- Split view layout with resizable divider
- New session modal (repo dropdown only, no host yet)
- Active sessions list in sidebar
- Reconnect to existing sessions
- Add Sonner toasts for errors

### Phase 4: Multi-Host Support
- Config file parsing (`~/.claude-run/config.json`)
- SSH spawn wrapper in `hosts.ts`
- Host selector in UI with status indicators
- Host health checks

### Phase 5: Polish
- Mobile optimizations (full-screen terminal mode)
- Session timeout/cleanup options
- Keyboard shortcuts (Cmd+T new terminal, Cmd+` toggle panel)

## Deployment

- API server runs on Raspberry Pi (192.168.1.31)
- Default host: MacStudio (192.168.1.5) via SSH
- Fallback: Local execution on Pi
