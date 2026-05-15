# Persistent Memory

Session-level persistent memory for Cursor. Saves structured summaries under `~/.cursor/persistent-memory/` (shared across projects on that machine). Run `/persistent-memory-retrieve` to browse and load past summaries into the current chat.

## Why

Cursor keeps chat history per client. Switch devices and the model loses prior context. Two common setups:

1. **Same remote, multiple clients** (e.g. two Macs SSH to one Linux host): Each client has its own local history; they do not sync. Summaries live in `~/.cursor/persistent-memory/` on the **server**, so every client that uses that home directory sees the same store.

2. **Different devices, no shared server**: Each machine has its own `~/.cursor/persistent-memory/`. Track that folder with git (or another sync tool): push from one device, pull on another.

After syncing or switching context, run `/persistent-memory-retrieve` (optionally with a natural-language query) to pull a summary back into context.

Inspired by [Thinking about Coding Agent Persistent Memory](https://xianzhu21.notion.site/thinking-about-coding-agent-persistent-memory).

## Installation

**Marketplace** (when published):

```bash
/add-plugin persistent-memory
```

**From source** (this repository root):

```bash
/add-plugin /path/to/persistent-memory
```

Manifest: [`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json).

## Prerequisites

- [Bun](https://bun.sh/) — the Stop hook runs as `bun run …/hooks/persistent-memory-stop.ts`

```bash
curl -fsSL https://bun.sh/install | bash
```

## How it works

- **Stop hook** — On eligible stops, emits `followup_message` (`PERSISTENT_MEMORY_TRIGGER=stop-hook`, optional `transcript_path=` / `conversation_id=`). **`generation_id` handling** matches **`continual-learning-stop.ts`**: if `generation_id` is present and equals `lastProcessedGenerationId` for this conversation, exit immediately with no state write (duplicate Stop); otherwise set `lastProcessedGenerationId` to `generation_id` or `null`, then run cadence (per-conversation fields in `.cursor/hooks/state/persistent-memory.json`).
- **Transcript path requirement** — Cadence also requires the transcript file **mtime** to have advanced since the last trigger. That uses **`transcript_path`** from hook input. If Cursor does not supply **`transcript_path`**, mtime cannot be checked and **no** automatic save is suggested (turn/minute thresholds alone are not enough).
- **persistent-memory-save** — Delegates to **`persistent-memory-saver`**. Hook path: **this chat only**. Manual **`/persistent-memory-save`:** **`existing-summaries`** scope by default — only **parent** transcripts for ids in **`.cursor/hooks/state/persistent-memory.json`** with **`lastTranscriptMtimeMs` not null** (Stop hook sets this when cadence emits the save follow-up; treated as “already in the hook save path”). No full `agent-transcripts/` walk and **no** glob of **`summaries/*.md`**. Chats the hook never promoted stay out of that default manual refresh until cadence sets **`lastTranscriptMtimeMs`**, **unless** the user passes an absolute parent **`*.jsonl`** (often **`@/…/agent-transcripts/…/….jsonl`**) — then **`explicit-transcript`** runs that file only (any Cursor project on disk; **first-time** allowed). See `skills/persistent-memory-save/SKILL.md`.
- **persistent-memory-retrieve** — `/persistent-memory-retrieve` with optional **natural-language** filter. **Default** (no query): rows whose tags include **`#project-<slug>`** for the current workspace, using the **same** dirname + **k-probe** rules as save (`skills/persistent-memory-retrieve/SKILL.md`). Say **`all`** / **`all projects`** to list across projects. Optional trailing number sets row limit (default **10**). Order follows **`sessions.md`** (`End` descending after save).

## Retrieve example

```
> /persistent-memory-retrieve surfaceflinger

---

1. `a3f1b2c4` · 2026-03-10 22:15 - 23:45

**Title:** SF parallel_refresh RE log, drawSummary

**Tags:** #project-mnt-2tb-android #surfaceflinger #parallel-refresh

---

2. `7d8e9f0a` · 2026-03-09 18:20

**Title:** Layer parent crash investigation

**Tags:** #project-mnt-2tb-android #surfaceflinger

Reply with a number (1-2) to load one, or "all" for all shown.

> 1
[Full summary .md content appears in chat, then a short “loaded” line]
```

- Filter by meaning: e.g. `/persistent-memory-retrieve gerrit commits we did last week` (semantic match on title, tags, and summary bodies).
- Widen the list: `/persistent-memory-retrieve 30` or `/persistent-memory-retrieve SF 50` (number = row limit).

## Storage

| Path | Purpose |
|------|---------|
| `~/.cursor/persistent-memory/sessions.md` | Index lines for conversations that have a written summary |
| `~/.cursor/persistent-memory/incremental-index.json` | Per-transcript absolute path → `mtimeMs`, `lastProcessedAt` |
| `~/.cursor/persistent-memory/incremental-index-*.json` | Optional **manual** snapshots; the save skill may consult them when merging index history |
| `~/.cursor/persistent-memory/summaries/` | `{conversation_id}.md` structured summaries |
| `~/.cursor/persistent-memory/transcripts/` | `{conversation_id}.jsonl.gz` compressed raw transcripts |
| `.cursor/hooks/state/persistent-memory.json` | Top-level **`conversations`**: per-`conversation_id` cadence + dedupe (see pruning). Missing or invalid JSON is rewritten when the hook **persists** state (end of a Stop that is **not** a duplicate **`generation_id`** short-circuit, which exits without writing). Missing id → key **`unknown`**. Path is resolved from the **stop hook process cwd** (normally the opened workspace folder). |

### Hook state pruning

Each **non-duplicate** Stop (after `generation_id` dedupe and cadence updates) can remove **other** `conversations` entries whose **`lastTranscriptMtimeMs`** is older than **`N` days** (default **`N` = 60** when **`PERSISTENT_MEMORY_CONVERSATIONS_PRUNE_AFTER_DAYS`** is unset). Set **`PERSISTENT_MEMORY_CONVERSATIONS_PRUNE_AFTER_DAYS=0`** to **disable** pruning. That field is the **transcript `.jsonl` mtime** stored when cadence **last fired a follow-up** for that chat (same watermark as `hasTranscriptAdvanced`). Chats that **never** reached a hook trigger keep **`lastTranscriptMtimeMs` null** and are **not** pruned. Default manual save (**`existing-summaries`**) **only** includes `conversation_id`s whose **`lastTranscriptMtimeMs`** is **not null** (hook has promoted a save at least once). Ids still **null** are not covered by manual **`existing-summaries`** until cadence sets **`lastTranscriptMtimeMs`**, except the user may run **`/persistent-memory-save`** with an absolute parent transcript path (**`explicit-transcript`** — no hook-state filter). The **current** `conversation_id` key is never removed in that pass.

**Git across devices**: Initialize or clone a repo at `~/.cursor/persistent-memory/`, commit summaries and index files as you prefer, and pull on other machines.

## Session list format

`sessions.md` is a **GitHub Flavored Markdown table** (markdown sheet): optional `# Persistent memory sessions` heading, then `| ID | Start | End | Title | Tags |`, a `| --- | …` separator row, and one data row per conversation (newest rows first). Each data row is:

`| {conversation_id[:8]} | {start} | {end} | {title} | {tags} |`

The **Tags** cell starts with a **`#project-<slug>`** tag: same **canonical** dirname for **Open Folder** and **Open `.code-workspace`** — after stripping `-code-workspace`, walk **`k` = 1,2,…** trailing segments as workspace stem until **`~/.cursor/projects/{base}/agent-transcripts`** exists, else fall back to one segment; then normalize — see `agents/persistent-memory-saver.md`. Up to three topic tags follow. That lets `/persistent-memory-retrieve` match **this repo** in either window mode.

Escape literal `|` in a cell as `\|`. **persistent-memory-retrieve** also accepts legacy plain lines (same five fields without table markup, or four-field lines without separate start).

## Trigger cadence

A **turn** is one completed user message plus one assistant reply (`status === "completed"`, `loop_count === 0`), with transcript **mtime** advanced since the last trigger **for that `conversation_id`** (cadence is per session). **Requires** a non-empty **`transcript_path`** on the Stop hook payload so the hook can `stat` the `.jsonl` file; without it, **`hasTranscriptAdvanced`** never becomes true and the hook never emits **`followup_message`**.

**Default** (after trial expires, if enabled):

- At least **8** completed turns since last run
- At least **60** minutes since last run

**Trial mode** — `bun run …/persistent-memory-stop.ts --trial` **or** `PERSISTENT_MEMORY_TRIAL_MODE=true`:

- Starts on first counted turn; lasts **24 hours** by default
- During the window: **3** turns and **15** minutes minimum
- Then the default cadence applies

## Environment overrides

| Variable | Purpose | Default |
|----------|---------|--------|
| `PERSISTENT_MEMORY_MIN_TURNS` | Min turns (outside trial window) | 8 |
| `PERSISTENT_MEMORY_MIN_MINUTES` | Min minutes since last run | 60 |
| `PERSISTENT_MEMORY_TRIAL_MODE` | Enable trial without `--trial` | false |
| `PERSISTENT_MEMORY_TRIAL_MIN_TURNS` | Min turns during trial | 3 |
| `PERSISTENT_MEMORY_TRIAL_MIN_MINUTES` | Min minutes during trial | 15 |
| `PERSISTENT_MEMORY_TRIAL_DURATION_MINUTES` | Trial length | 1440 (24h) |
| `PERSISTENT_MEMORY_CONVERSATIONS_PRUNE_AFTER_DAYS` | Drop **other** hook-state conversations older than this many days (see **Hook state pruning**); **`0`** = off | **60** |

## Repository

- **GitHub**: [xianzhu21/persistent-memory](https://github.com/xianzhu21/persistent-memory)

## License

MIT
