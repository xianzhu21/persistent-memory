---
name: persistent-memory-retrieve
description: When user types /persistent-memory-retrieve [query], read ~/.cursor/persistent-memory/sessions.md, filter by semantic match (title/tags/summary), preserve sessions.md line order, show session list, let user select, then load full summary into context.
---

# Persistent Memory Retrieve

Browse and load past session summaries into the current context. Use when the user types `/persistent-memory-retrieve` or `/persistent-memory-retrieve` followed by a natural-language query.

## Workflow

1. **Read session list** from `~/.cursor/persistent-memory/sessions.md`
2. **Parse lines** – build the session list from `sessions.md` in file order (top to bottom):
   - **Markdown table (current):** Ignore the `#` heading, blank lines, the header row `| ID | Start | …`, and the separator row `| --- | …`. For each following line that starts with `|`, parse **five cells** (split on `|`, trim; treat `\|` inside a cell as a literal pipe). Skip malformed rows.
   - **Legacy plain lines:** `{id_prefix} | {start} | {end} | {title} | {tags}` (5 fields) or `{id_prefix} | {end} | {title} | {tags}` (4 fields). If 4 fields, treat the single timestamp as end only. Use for files not yet converted to a table.
3. **Parse limit** – if the query ends with a number (e.g. `30` or `50`), use it as N; otherwise N = 15. E.g. `persistent-memory-retrieve SF 30` → query = "SF", N = 30; `persistent-memory-retrieve 30` → query = "", N = 30.
4. **Filter** – treat the remainder as a natural-language query (sentence or phrase). **Semantic filtering:** interpret the user's intent and include only sessions whose `{title}`, `{tags}`, or summary content is semantically relevant. E.g. "SF crash we investigated before" → SurfaceFlinger crash/investigation sessions; "Cursor pricing" → Cursor pricing; "gerrit commits" → Gerrit commit/CL sessions. Use meaning, not just keyword substring match. If no query, show all. **Order:** scan `sessions.md` from top to bottom; keep each matching line in that order (do **not** re-sort by summary file mtime or by `{end}` timestamp).
5. **Display** – show top N entries (default 15) as a **Markdown table** so it renders in chat. Include header and separator:
   ```
   | # | ID | Time | Title | Tags |
   | --- | --- | --- | --- | --- |
   | 1 | a3f1b2c4 | 2026-03-10T2215–2345 | SurfaceFlinger relative parent crash | #surfaceflinger #parallel-refresh |
   | 2 | 7d8e9f0a | 2026-03-10T1820 | TaskSnapshot NPE monkey test | #systemui #tasksnap |
   ...
   ```
   For 5-field lines show `start–end` in the Time column (**conversation span:** transcript birth → transcript last modified per `persistent-memory-save`, not summary save time); for 4-field legacy show the single timestamp only. **Optional limit:** if the user ends the query with a number (e.g. `persistent-memory-retrieve 30` or `persistent-memory-retrieve SF 50`), use that as N.
   **When total > N:** after the table, append: *"Showing top N of {total} sessions. Reply with a number (1–N) to load one, 'all' to load all shown, or a larger number / 'more' to show more entries."*
6. **User reply** – interpret as follows:
   - **Number 1..N** → load that session (go to Load step)
   - **"all"** → load all shown sessions
   - **Number > N** (e.g. "30" when N=15) **or "more"** → show more: re-display with that limit (or N+15 for "more"). Then prompt again.
   - Alternatively, the user may add a limit in the command: `/persistent-memory-retrieve [query] 30`
7. **Load** – for each selected item, read `~/.cursor/persistent-memory/summaries/{conversation_id}.md` (use id_prefix to match – if multiple match, take most recent). If id_prefix is 8 chars, match files whose name starts with that prefix
8. **Inject** – **MUST** output the full summary content verbatim in chat first; **then** append the instruction line. Do **not** skip to the instruction without displaying the summary.
   - First: paste the entire `{conversation_id}.md` file content (all sections: Summary, Workspace, Key paths, Transcript, Key findings, Decisions, References, Tags, etc.) into your response
   - Second: add "The above session summary has been loaded. You may use it as context for the current task."

## Matching ID to File

- Session list lines use first 8 chars of conversation_id (e.g. `a3f1b2c4`)
- Summary files are named `{full_conversation_id}.md`
- To resolve: list `~/.cursor/persistent-memory/summaries/*.md`, find file whose stem (filename without .md) starts with the id_prefix. If multiple match, pick the most recent by file mtime.

## When Session List is Empty

If `sessions.md` does not exist or is empty:

```
No session memories found. Summaries are created automatically when you have longer conversations (triggered by the persistent-memory Stop hook via persistent-memory-save).
```

## Stub / thin summaries

If a `summaries/{id}.md` file is only a **tooling placeholder** (e.g. "Batch save", "N text segments") while the gzip transcript is large and substantive, tell the user the summary is **out of date** and they should run **`/persistent-memory-save`** again from the **same workspace** where that chat lives (or **all projects**), so the save skill can **merge** real `## Key findings` / `## Decisions` from the full JSONL. Root cause is often **wrong transcript slug** (single-folder vs `.code-workspace`) — fixed in `persistent-memory-save` step 1.

## Examples

- `/persistent-memory-retrieve` → show top 15 sessions, in **sessions.md** order (top to bottom)
- `/persistent-memory-retrieve SF crash we investigated before` → sessions about SurfaceFlinger crash investigation (semantic match)
- `/persistent-memory-retrieve Cursor pricing and plans` → sessions about Cursor pricing/plans
- `/persistent-memory-retrieve gerrit code review and commits` → sessions about Gerrit reviews and commits
