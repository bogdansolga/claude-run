# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs both frontend and API concurrently)
pnpm dev

# Build for production
pnpm build

# Run production build
pnpm start
```

Development runs:
- Frontend: http://localhost:12000 (Vite dev server)
- API: http://localhost:12001 (tsx watch)

The `serveStatic` warning during dev is expected - static files are only built for production.

## Architecture

This is a web UI for browsing Claude Code conversation history stored in `~/.claude/`.

### API Layer (`api/`)

- **index.ts** - CLI entry point using Commander, parses options and starts server
- **server.ts** - Hono HTTP server with SSE streaming endpoints
- **storage.ts** - Reads Claude's JSONL files from `~/.claude/projects/` and `~/.claude/history.jsonl`
- **watcher.ts** - Chokidar file watcher with debouncing, emits events on history/session changes

Key data flow:
1. `history.jsonl` contains session metadata (display text, project, timestamp)
2. Each session's messages are in `~/.claude/projects/{encoded-project}/{sessionId}.jsonl`
3. Watcher detects changes and emits to SSE clients for real-time updates

### Web Layer (`web/`)

- **app.tsx** - Main React app with session list and conversation view
- **hooks/use-event-source.ts** - Custom hook for SSE streaming
- **components/session-view.tsx** - Renders conversation messages
- **components/tool-renderers/** - Specialized renderers for different tool types (Bash, Edit, Read, etc.)

Type imports from API: `import type { Session } from "@claude-run/api"` via Vite alias.

### Build Output

- `dist/index.js` - CLI entry point (tsup)
- `dist/web/` - Static frontend (Vite)
- Production serves frontend from `dist/web/` or sibling `web/` directory
