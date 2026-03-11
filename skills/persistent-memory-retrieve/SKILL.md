---
name: persistent-memory-retrieve
description: When user types /persistent-memory-retrieve or /persistent-memory-retrieve #tag, read ~/.cursor/persistent-memory/index.md, show recent session list (optionally filtered by tag), let user select, then load full summary into context.
---

# Persistent Memory Retrieve

Browse and load past session summaries into the current context. Use when the user types `/persistent-memory-retrieve` or `/persistent-memory-retrieve #tag`.

## Workflow

1. **Read index** from `~/.cursor/persistent-memory/index.md`
2. **Parse lines** – format: `{id_prefix} | {timestamp} | {title} | {tags}`
3. **Filter** – if user provided a tag (e.g. `/persistent-memory-retrieve #surfaceflinger`), show only lines whose `{tags}` contain that tag (case-insensitive match)
4. **Display** – show last N entries (default 15) as a numbered list:
   ```
   1. 2026-03-10T2345 | SurfaceFlinger relative parent crash | #surfaceflinger #parallel-refresh
   2. 2026-03-10T1820 | TaskSnapshot NPE monkey test | #systemui #tasksnap
   ...
   ```
5. **User selects** – user replies with a number (e.g. "1") or "all" for multiple
6. **Load** – for each selected item, read `~/.cursor/persistent-memory/{conversation_id}.md` (use id_prefix to match – if multiple match, take most recent). If id_prefix is 8 chars, match files whose name starts with that prefix
7. **Inject** – output the full summary content and instruct: "The above session summary has been loaded. You may use it as context for the current task."

## Matching ID to File

- Index lines use first 8 chars of conversation_id (e.g. `a3f1b2c4`)
- Summary files are named `{full_conversation_id}.md`
- To resolve: list `~/.cursor/persistent-memory/*.md`, find file whose stem (filename without .md) starts with the id_prefix. If multiple, pick by mtime or include all.

## When Index is Empty

If `index.md` does not exist or is empty:

```
No session memories found. Summaries are created automatically when you have longer conversations (triggered by the persistent-memory Stop hook via persistent-memory-save).
```

## Examples

- `/persistent-memory-retrieve` → show last 15 sessions
- `/persistent-memory-retrieve #surfaceflinger` → show sessions tagged #surfaceflinger
- `/persistent-memory-retrieve #cursor` → show sessions tagged #cursor
