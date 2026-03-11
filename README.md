# Persistent Memory

Session-level persistent memory for Cursor. Saves structured summaries to `~/.cursor/persistent-memory/` (shared across all projects). Use `/persistent-memory-retrieve` to load past session summaries into the current context.

## Why

Cursor stores chat history on each client. Switch devices and the AI loses context. Two common scenarios:

1. **Same remote, multiple clients** (e.g., two Macs SSH to one Ubuntu): Each client has its own local history—they never sync. Summaries are written to `~/.cursor/persistent-memory/` on the remote; because that path lives on the server, every client sees the same store.

2. **Different devices, no shared server** (e.g., laptop and desktop, each running Cursor locally): Summaries live in each machine's home dir. Use git on `~/.cursor/persistent-memory/` to sync across devices; push from one, pull on another.

In both cases, run `/persistent-memory-retrieve` on the new device to load past summaries into context.

Inspired by [Thinking about Coding Agent Persistent Memory](https://xianzhu21.notion.site/thinking-about-coding-agent-persistent-memory).

## Installation

**From Marketplace** (once published):
```bash
/add-plugin persistent-memory
```

**From source** (local development):
```bash
/add-plugin /path/to/persistent-memory-plugin
```

## Prerequisites

- [Bun](https://bun.sh/) for running the Stop hook

```bash
curl -fsSL https://bun.sh/install | bash
```

## How it works

- **Stop hook** – On eligible session ends, emits a `followup_message` that triggers the `persistent-memory-save` skill.
- **persistent-memory-save** – Incrementally updates the summary (like continual-learning): only processes new transcript lines, merges with existing (reconciling contradictions). Triggered by Stop hook, or manually via `/persistent-memory-save`. Writes to `~/.cursor/persistent-memory/{conversation_id}.md`, updates `sessions.md` and `incremental-index.json`.
- **persistent-memory-retrieve** – User types `/persistent-memory-retrieve` or `/persistent-memory-retrieve #tag` to browse and load past summaries.

## Retrieve example

```
> /persistent-memory-retrieve

1. 2026-03-11T1215 | Persistent-memory plugin refactor | #persistent-memory #cursor
2. 2026-03-10T1820 | SurfaceFlinger layer debugging | #surfaceflinger
3. 2026-03-09T1430 | Notion MCP integration | #notion #mcp

Reply with a number (1–3) to load that session, or "all" to load all.

> 2
[Summary of session 2 is loaded into context]
```

Filter by tag: `/persistent-memory-retrieve #surfaceflinger` shows only sessions with that tag.

## Storage

| Path | Purpose |
|------|---------|
| `~/.cursor/persistent-memory/` | Session summaries (`{id}.md`), `sessions.md` (session list), `incremental-index.json` (processing progress), `incremental-index-YYYY-MM-DDTHHMMSS.json` (archive snapshots) |
| `.cursor/hooks/state/persistent-memory.json` | Per-workspace state (turns, last run) |

**Archiving**: When `incremental-index.json` has ≥500 conversations (configurable), the oldest 80% are moved to a timestamped archive file. Each run creates a new file (e.g. `incremental-index-2025-03-11T143052.json`). The save skill consults both the main index and archives when looking up `lastProcessedLineCount`.

**Sync across devices with git**: Initialize `~/.cursor/persistent-memory/` as a git repo and push to a remote. Pull on other machines to keep summaries in sync—works even when devices don't share the same SSH server.

## Trigger cadence

A *turn* is one completed user message plus one assistant reply (status=completed, loop_count=0).

**Default cadence** (after trial expires):
- minimum 10 completed turns
- minimum 120 minutes since last run
- transcript mtime must advance

**Trial mode** (first 24h after first turn; enable via `--trial` in hook or `PERSISTENT_MEMORY_TRIAL_MODE=true`):
- minimum 3 completed turns
- minimum 15 minutes
- then falls back to default cadence

## Optional env overrides

| Env | Purpose | Default |
|-----|---------|--------|
| `PERSISTENT_MEMORY_MIN_TURNS` | Min turns (default cadence) | 10 |
| `PERSISTENT_MEMORY_MIN_MINUTES` | Min minutes since last run | 120 |
| `PERSISTENT_MEMORY_TRIAL_MODE` | Enable trial when no `--trial` arg | false |
| `PERSISTENT_MEMORY_TRIAL_MIN_TURNS` | Min turns in trial | 3 |
| `PERSISTENT_MEMORY_TRIAL_MIN_MINUTES` | Min minutes in trial | 15 |
| `PERSISTENT_MEMORY_TRIAL_DURATION_MINUTES` | Trial window length | 1440 (24h) |
| `PERSISTENT_MEMORY_ARCHIVE_COUNT` | Archive when conversations ≥ this | 500 |

## License

MIT
