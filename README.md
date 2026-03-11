# Persistent Memory

Session-level persistent memory for Cursor. Saves structured summaries to `~/.cursor/persistent-memory/` (shared across all projects). Use `/persistent-memory-retrieve` to load past session summaries into the current context.

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
- **persistent-memory-save** – Reads the transcript (JSONL), generates a structured summary, writes to `~/.cursor/persistent-memory/{conversation_id}.md`, updates `index.md`.
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
| `~/.cursor/persistent-memory/` | Session summaries (`{id}.md`) and `index.md` (shared) |
| `.cursor/hooks/state/persistent-memory.json` | Per-workspace state (turns, last run) |

## Trigger cadence

A *turn* is one completed user message plus one assistant reply (status=completed, loop_count=0).

**Default cadence** (after trial expires):
- minimum 10 completed turns
- minimum 120 minutes since last run
- transcript mtime must advance

**Trial mode** (first 24h after first turn, enabled via `--trial` in hook):
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

## License

MIT
