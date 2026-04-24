---
name: persistent-memory-retrieve
description: "List and load user-session summaries from ~/.cursor/persistent-memory for recall and handoff (not subagent tool logs; prefer project-tagged scope unless user asks for all projects)."
---

# Persistent Memory Retrieve

**Why:** Answer “what we did / decided before” by surfacing **saved user chats** (structured summaries + optional gzip), not re-scanning the whole `agent-transcripts` tree. **Scenarios:** resume a feature months later, compare two investigations, or paste a prior **## Decisions** / **## References** into the current task.

**How:** Read `sessions.md` → filter (default: **#project-…** for this workspace) → let the user pick a row → read `summaries/{id}.md` (and gzip only if they need line-level replay).

Use when the user types `/persistent-memory-retrieve` or a natural-language recall query (with or without filters).

## Workflow

1. **Read session list** from `~/.cursor/persistent-memory/sessions.md`  
   - If the user says a row is useless, **subagent** runs may have been summarized before the policy: titles that look like “run the full save flow” for **IDs** that match **subagent** delegation are often **worker logs**, not user project work. Prefer the **parent** session from the same window when the user is looking for “what I did” in a repo.
   - **Legacy summary files** may still contain a **second** `#` H1 or “## Incremental merge / ## Superseded” blocks (pre–full-re-synthesis). When you **read** `~/.cursor/persistent-memory/summaries/{id}.md` to answer a pick: treat **only the first** canonical `# {start} | {end} | {title}` block and the following `##` sections **until** a horizontal rule `---` or a line starting with `## Superseded` / `## Incremental merge` as the **authoritative** summary; **do not** treat later duplicate H1s or URL dumps in stale tails as the main session (point the user to gzip for raw replay if the tail is noisy).
2. **Parse lines** – build the session list from `sessions.md` in file order (top to bottom). After a successful `persistent-memory-save`, data rows are **sorted by `End` descending**; scanning top to bottom is therefore newest-`End` first (legacy or hand-edited files may be unsorted; in that case you may sort by `End` descending when displaying for consistency).
   - **Markdown table (current):** Ignore the `#` heading, blank lines, the header row `| ID | Start | …`, and the separator row `| --- | …`. For each following line that starts with `|`, parse **five cells** (split on `|`, trim; treat `\|` inside a cell as a literal pipe). Skip malformed rows.
   - **Legacy plain lines:** `{id_prefix} | {start} | {end} | {title} | {tags}` (5 fields) or `{id_prefix} | {end} | {title} | {tags}` (4 fields). If 4 fields, treat the single timestamp as end only. Use for files not yet converted to a table.
3. **Parse limit** – if the command text ends with a **trailing** positive integer (e.g. `30` or `50`), use it as **N**; otherwise **N = 10** (default row cap). E.g. `persistent-memory-retrieve SF 30` → query = "SF", N = 30; `persistent-memory-retrieve 30` → query = "", N = 30; bare `/persistent-memory-retrieve` → N = 10.
4. **Resolve current `#project-<slug>`** (same rules as `agents/persistent-memory-saver.md`; suitable and **required** for retrieve, not a different heuristic):
   - From the **current workspace**, determine the Cursor **projects** folder name that would hold this window’s transcripts: the segment **above** `agent-transcripts` in `~/.cursor/projects/<workspace-folder>/agent-transcripts/` (infer from open folder / workspace the same way the saver resolves transcript roots; use the folder that applies to **this** chat).
   - Apply **identical** canonicalization to that `<workspace-folder>`: if it ends with `-code-workspace`, form **`inner`**, split on `-`, handle **`len(segments) < 2`**, then for **`k` = 1,2,…** probe **`~/.cursor/projects/{base}/agent-transcripts`** until a directory exists, else **`k` = 1** fallback; then **normalize** to `[a-z0-9-]` (lowercase, collapse hyphens, etc.) → build token **`#project-<slug>`**.
   - If the folder cannot be determined, set **`current_project_tag`** = unset (unknown).
5. **Filter** – treat the remainder as a natural-language query (sentence or phrase), after stripping a leading **global** intent if present: phrases like **`all`**, **`all projects`**, **`everywhere`**, **`global`** mean **do not** apply the project filter below (show across projects).
   - **Empty query** (after limit parse): if **`current_project_tag`** is set, include only rows whose **`{tags}`** cell contains that exact hashtag token (substring match is fine). If unset, include **all** rows (cannot scope).
   - **Non-empty query:** **Semantic filtering**: include sessions whose `{title}`, `{tags}`, or summary content is semantically relevant (e.g. "SF crash we investigated before" → SurfaceFlinger crash sessions). Use meaning, not only keywords. Unless the user’s wording clearly asks for **this project** / **here** / **current repo**, do **not** require `current_project_tag`; if they do ask, **intersect** semantic matches with **`{tags}`** containing **`current_project_tag`** when it is set. If the query clearly spans **other** projects or past work elsewhere, do not force the project filter.
   - **Legacy rows** without `#project-…` in `{tags}`: when project filtering is active (empty query with known tag), **exclude** them from the list, or include only if the user asked **all projects**; prefer **exclude** so the list matches the current workspace.
   **Order:** keep matches in **`sessions.md` file order** (normally `End` descending after save). Do **not** re-sort by summary file mtime. If the file looks out of order, sort matches by `End` descending for display.
6. **Display** – show top **N** entries (default **10**) as a **block list**, not a five-column markdown table. Chat UIs give each table column a share of width, which squeezes **Title** (and **Tags**) when **ID** and **Time** sit on the same row, especially after filtering leaves fewer rows.
   - **Scannability (MUST):** Each session must be **easy to pick out** when skimming: use a **horizontal rule** `---` **between** sessions (and one before the first entry is recommended so the list has a clear top edge). Start each session with a **numbered list marker** **`{n}.`** (e.g. `1.`, `2.`) so the numeral matches what the user replies with. On the **same line**: the marker, then **` `{id_prefix}` · `** (backticks around id only), then the **human-readable time** (see below; do **not** paste raw `YYYY-MM-DDTHHMM` tokens in the list).
   - **Readable time (MUST):** `sessions.md` uses wall times as `YYYY-MM-DDTHHMM` (letter `T`, then **four** digits `HHMM`, no colon). For **display only**, parse and reformat:
     1. **One stamp** `YYYY-MM-DDTHHMM` → **`YYYY-MM-DD HH:MM`** (insert `:` between hour and minute; replace `T` with a space).
     2. **Start + End** from table columns: normalize **Start** and **End** each as in (1). If the **date** part (first 10 chars) is **identical**, show **`{date} {startHH:MM} - {endHH:MM}`** (one date, two times). If dates **differ**, show **`{startFull} - {endFull}`** using the full normalized form from (1) for each side, separated by **` - `**.
     3. **Legacy single cell** that already joins start/end with a hyphen (e.g. `2026-03-10T2215-2345` meaning same-day end time only): treat as **one date** `2026-03-10`, first time `2215`, second time `2345`, then display as **`2026-03-10 22:15 - 23:45`**. If the cell instead contains two full `YYYY-MM-DDTHHMM` values separated by `-`, split and apply (2).
     4. **4-field legacy** (end only): normalize that single stamp with (1).
     (**Conversation span** is still transcript birth → transcript last modified per `persistent-memory-save`, not summary save time.)
   - For each match `i` (1…N), use this pattern:
   ```
   ---

   1. `a3f1b2c4` · 2026-03-10 22:15 - 23:45

   **Title:** SurfaceFlinger relative parent crash investigation

   **Tags:** #project-mnt-2tb-android #surfaceflinger #parallel-refresh

   ---

   2. `7d8e9f0a` · 2026-03-10 18:20

   **Title:** TaskSnapshot NPE monkey test

   **Tags:** #project-mnt-2tb-android #systemui #tasksnap
   ```
   Reply **`3`** must load the session whose block starts with **`3.`** on the identity line. Put **Title** and **Tags** each on their **own line** after the label so long text wraps at the full panel width.
   - **Do not** render the session list as `| # | ID | Time | Title | Tags |`; that layout is deprecated for display (storage in `sessions.md` remains a table).
   **Optional limit:** if the user ends the query with a number (e.g. `persistent-memory-retrieve 30` or `persistent-memory-retrieve SF 50`), use that as N.
   **When total > N:** after the list, append: *"Showing top N of {total} sessions. Reply with a number (1-N) to load one, 'all' to load all shown, or a larger number / 'more' to show more entries."*
7. **User reply** – interpret as follows:
   - **Number 1..N** → load that session (go to Load step)
   - **"all"** → load all shown sessions
   - **Number > N** (e.g. "30" when N=10) **or "more"** → show more: re-display with that limit, or for **"more"** alone use **N' = N + 10** (same filter). Then prompt again.
   - **Limit-only follow-up (MUST):** If the user sends **only** a new row cap (e.g. **`set limit to 10`**, **`limit 10`**, **`show 10`**, **`10`**, **`N=20`**) **and** this chat already has an **immediately preceding** persistent-memory retrieve list (same turn sequence: you showed a filtered list and they did not start unrelated work), **reuse the same filter**: same **global vs project** intent, same **natural-language query** (or same empty-query project scope), **only change N**. Re-read `sessions.md`, re-apply steps 5–6, and re-prompt. If there is **no** prior retrieve context in the chat, treat the message as ambiguous: ask whether they meant **`/persistent-memory-retrieve … <N>`** or repeat the intended query.
   - Alternatively, the user may add a limit in the command: `/persistent-memory-retrieve [query] 30`
8. **Load** – for each selected item, read `~/.cursor/persistent-memory/summaries/{conversation_id}.md` (use id_prefix to match; if multiple match, take most recent). If id_prefix is 8 chars, match files whose name starts with that prefix
9. **Inject** – **MUST** output the full summary content verbatim in chat first; **then** append the instruction line. Do **not** skip to the instruction without displaying the summary.
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

If a `summaries/{id}.md` file is only a **tooling placeholder** (e.g. "Batch save", "N text segments") while the gzip transcript is large and substantive, tell the user the summary is **out of date** and they should run **`/persistent-memory-save`** again from the **same workspace** where that chat lives (default **`existing-summaries`** only picks ids with **`lastTranscriptMtimeMs` not null** in `.cursor/hooks/state/persistent-memory.json`; if that field is still null, rely on the Stop hook **`current-session`** path once cadence promotes the chat). Root cause is often **wrong transcript slug** (single-folder vs `.code-workspace`); fixed in `persistent-memory-save` / saver step 1.

## Examples

- `/persistent-memory-retrieve` → resolve **`current_project_tag`** with the same **k-probe** rules as save; show top **10** rows whose `{tags}` contain that tag (this workspace only). If tag unknown, show top **10** of **all** rows. Use **`all`** / **`all projects`** in the query to list across projects.
- `/persistent-memory-retrieve SF crash we investigated before` → sessions about SurfaceFlinger crash investigation (semantic match)
- `/persistent-memory-retrieve Cursor pricing and plans` → sessions about Cursor pricing/plans
- `/persistent-memory-retrieve gerrit code review and commits` → sessions about Gerrit reviews and commits
- `/persistent-memory-retrieve all` or **`all 30`** → skip project filter; show up to N rows from **all** projects
