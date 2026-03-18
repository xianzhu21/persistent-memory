---
name: persistent-memory-retrieve
description: When user types /persistent-memory-retrieve [query], read ~/.cursor/persistent-memory/sessions.md, filter by semantic match (title/tags/summary), sort by summary file mtime descending, show session list, let user select, then load full summary into context.
---

# Persistent Memory Retrieve

Browse and load past session summaries into the current context. Use when the user types `/persistent-memory-retrieve` or `/persistent-memory-retrieve` followed by a natural-language query.

## Workflow

1. **Read session list** from `~/.cursor/persistent-memory/sessions.md`
2. **Parse lines** – format: `{id_prefix} | {start} | {end} | {title} | {tags}` (5 fields) or legacy `{id_prefix} | {end} | {title} | {tags}` (4 fields). If 4 fields, treat the single timestamp as end only.
3. **Filter** – treat everything after `/persistent-memory-retrieve` as a natural-language query (sentence or phrase). **Semantic filtering:** interpret the user's intent and include only sessions whose `{title}`, `{tags}`, or summary content is semantically relevant. E.g. "SF crash we investigated before" → SurfaceFlinger crash/investigation sessions; "Cursor pricing" → Cursor pricing; "gerrit commits" → Gerrit commit/CL sessions. Use meaning, not just keyword substring match. If no query, show all.
4. **Sort** – resolve each line's `{id_prefix}` to the summary file path under `~/.cursor/persistent-memory/summaries/`; sort by summary file modification time descending (newest first).
5. **Display** – show top N entries (default 15) as a **Markdown table** so it renders in chat. Include header and separator:
   ```
   | # | ID | Time | Title | Tags |
   | --- | --- | --- | --- | --- |
   | 1 | a3f1b2c4 | 2026-03-10T2215–2345 | SurfaceFlinger relative parent crash | #surfaceflinger #parallel-refresh |
   | 2 | 7d8e9f0a | 2026-03-10T1820 | TaskSnapshot NPE monkey test | #systemui #tasksnap |
   ...
   ```
   For 5-field lines show `start–end` in the Time column; for 4-field legacy show the single timestamp only.
6. **User selects** – user replies with a number (e.g. "1") or "all" for multiple
7. **Load** – for each selected item, read `~/.cursor/persistent-memory/summaries/{conversation_id}.md` (use id_prefix to match – if multiple match, take most recent). If id_prefix is 8 chars, match files whose name starts with that prefix
8. **Inject** – output the full summary content and instruct: "The above session summary has been loaded. You may use it as context for the current task."

## Matching ID to File

- Session list lines use first 8 chars of conversation_id (e.g. `a3f1b2c4`)
- Summary files are named `{full_conversation_id}.md`
- To resolve: list `~/.cursor/persistent-memory/summaries/*.md`, find file whose stem (filename without .md) starts with the id_prefix. If multiple match, pick the most recent by file mtime.

## When Session List is Empty

If `sessions.md` does not exist or is empty:

```
No session memories found. Summaries are created automatically when you have longer conversations (triggered by the persistent-memory Stop hook via persistent-memory-save).
```

## Examples

- `/persistent-memory-retrieve` → show top 15 sessions, sorted by summary file mtime descending
- `/persistent-memory-retrieve SF crash we investigated before` → sessions about SurfaceFlinger crash investigation (semantic match)
- `/persistent-memory-retrieve Cursor pricing and plans` → sessions about Cursor pricing/plans
- `/persistent-memory-retrieve gerrit code review and commits` → sessions about Gerrit reviews and commits
