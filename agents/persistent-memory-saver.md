---
name: persistent-memory-saver
description: Update session summaries from project transcripts; full re-synthesis into summaries/*.md (single H1), gzip archives, sessions.md, and ~/.cursor/persistent-memory/incremental-index.json.
model: inherit
---

# Persistent memory saver

Own the full session summary persistence flow for persistent-memory.

## Parent agent (MUST NOT)

The **parent** chat that invoked `persistent-memory-save` must **only** launch this saver via the **Task** tool (`subagent_type: persistent-memory-saver`) and return the outcome. It must **not** implement this document’s file writes (summaries, gzip, `sessions.md`, `incremental-index.json`) in the parent session as a shortcut. **Same disk result from the parent still counts as a bypass** and breaks the “orchestration-only parent” contract.

## Goal and scenarios (read first)

- **Goal:** Keep **durable, user-meaningful** recall of work done in **Cursor**—decisions, file edits, tickets, Notion/Jira/MR context, and **handoff** to the *next* chat or machine—**without** expecting `persistent-memory-retrieve` or a human to grep raw `agent-transcripts` JSONL every time. A **summary** is the *default* read surface: short, structured, and tagged for search. A **gzipped JSONL** under `transcripts/` is the **source of truth** for replay, diff-level detail, and copy-with-you backup alongside `summaries/`.
- **User session = unit of value:** The artifact is the **parent** user/assistant thread (`{transcript_root}/{conversation_id}/{conversation_id}.jsonl`). **Subagent** paths (`…/subagents/…`) are **orchestration logs**—useful to debug a run, not “what the user accomplished in the repo”; they are **index-only** (no summary) so memory stays **actionable and honest**.
- **Scenarios (when this runs well):**  
  1. **After a long chat** (Stop hook, **current-session**): capture the window that just did real work, one transcript at a time, cadence permitting.  
  2. **Manual default — existing summaries only** (manual `/persistent-memory-save`, **`existing-summaries`**): **refresh-only set** — read **`.cursor/hooks/state/persistent-memory.json`** and include only `conversation_id`s whose **`lastTranscriptMtimeMs` is not null** (Stop hook sets it when cadence fires the save follow-up; proxy for “already went through hook save promotion”). Map those ids to parent `*.jsonl` under step‑1 roots. **Does not** list **`~/.cursor/persistent-memory/summaries/*.md`** (cheap at scale). Ids still **null** in hook state are **not** processed here; **first-time** capture is only via Stop hook **`current-session`**.  
  3. **“What did we decide on XHMI-… / this file?”** (`/persistent-memory-retrieve`): `sessions.md` is the **catalog**; the summary is the **answer**; gzip when the user needs verbatim tools or ordering.  
  4. **Cross-device** (optional): the user can sync `~/.cursor/persistent-memory/` so **summaries + `transcripts/*.jsonl.gz` + index** move together; **re-synthesis** on save keeps a single H1 and avoids append-only file rot.
- **Not goals:** A full org wiki, **git** or issue tracker (link out), automatic logging of every trivial or meta-only turn, or treating **subagent** traces as end-user “sessions.”
- **Spec consequence:** Every write that produces a `summaries/{id}.md` must be **useful in isolation** for retrieve (clear **## Summary** / **## Decisions** / **## Tags**), **one H1** per file, and **no** URL or rules **dumping** (see **Output format** and **Merge and full re-synthesis (MUST)**).

## Trigger

Use from `persistent-memory-save` when the Stop hook, `/persistent-memory-save`, or incremental transcript processing requires updating `~/.cursor/persistent-memory/` artifacts.

Incrementally update structured session summaries from the **current project's** agent transcripts and persist for `persistent-memory-retrieve`. Output in English only. **Do not truncate** session *meaning* (capture multi-topic and full decisions). The **on-disk** summary for each `conversation_id` is a **single document** with **one** top-level `#` H1 (see **Merge and full re-synthesis (MUST)** and **Output Format**).

**Write-to-disk contract:** Task prompt sets scope — **`existing-summaries`**: only parent transcripts under step‑1 roots for `conversation_id`s in **`.cursor/hooks/state/persistent-memory.json`** with **`lastTranscriptMtimeMs` not null** (step 3; no full tree walk, no **`summaries/`** glob). **`current-session`**: full tree walk under discovered roots (step 3), then **exactly one** target transcript via “Current session resolution” (Stop hook follow-up usually includes `transcript_path=` / `conversation_id=` when known).

For each transcript you process (by absolute path): if there is substantive content, write the summary to `~/.cursor/persistent-memory/summaries/{conversation_id}.md`, compress and save the raw transcript to `~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`, and upsert `~/.cursor/persistent-memory/sessions.md` (sessions.md reflects which conversations have summary content); always update `~/.cursor/persistent-memory/incremental-index.json` for processed transcript paths (`transcripts` key, `mtimeMs` + `lastProcessedAt`). Do **not** respond with summaries in chat instead of writing. Exceptions: empty/unreadable transcript, **subagent process logs** (path contains a `subagents` segment under `agent-transcripts/`—see step 4), or no substantive content — then do **not** write or update the summary file and do **not** add/update that conversation in sessions.md; update the index only. See "When to Skip".

## Inputs

- **Scope:** Task prompt **`PERSISTENT_MEMORY_SCOPE=existing-summaries`** or **`current-session`** only (no other values). If upstream includes **`PERSISTENT_MEMORY_TRIGGER=stop-hook`**, use **`current-session`**; otherwise (manual **`/persistent-memory-save`**) use **`existing-summaries`**. If the scope line is missing, infer the same way from hook token presence vs manual. Treat **`hook-state`** as a deprecated alias for **`existing-summaries`** (same rules).
- **Optional hints (current-session):** `conversation_id=<full id>` and/or `transcript_path=<absolute path to *.jsonl>` when the parent agent supplies them.
- **Transcript root(s):** One or more dirs `.../agent-transcripts/` under `~/.cursor/projects/` (see workflow step 1). **Not** always a single slug: opening via a **VS Code workspace** file (`.code-workspace`) usually creates a separate Cursor project folder like `.../<slug>-<workspace-stem>-code-workspace/agent-transcripts/`, while **Open Folder** on the repo uses `.../<slug>/agent-transcripts/` (same disk tree, different project slug).
- **Incremental index:** `~/.cursor/persistent-memory/incremental-index.json`
- **Summary dir:** `~/.cursor/persistent-memory/summaries/`
- **Transcript archive dir:** `~/.cursor/persistent-memory/transcripts/`
- **Session list:** `~/.cursor/persistent-memory/sessions.md`

Discover transcript roots from the project context. For **`existing-summaries`**, read hook state JSON (step 3), keep ids with **`lastTranscriptMtimeMs` not null**, and map each to parent JSONL paths under those roots only (no full tree walk, no **`summaries/`** directory listing). For **`current-session`**, perform the step‑3 tree walk under those roots, then resolve the single target file per **Current session resolution** (hints or fallback).

## Workflow

1. **Resolve transcript root(s)**  
   Infer a **workspace token** from the current context (e.g. repo folder basename such as `monalisadesign-gloable`). Under `~/.cursor/projects/`, collect **every** existing directory named `agent-transcripts` whose parent folder name **contains** that token (case-sensitive substring match).  
   **Always check both** when applicable: `~/.cursor/projects/<slug>/agent-transcripts` **and** `~/.cursor/projects/<slug>-<workspace-stem>-code-workspace/agent-transcripts` (any `...-*-code-workspace/agent-transcripts` sharing the same token)—Cursor writes parent chats under the slug for **how the window was opened** (folder vs `.code-workspace`), not whether the `.code-workspace` lists one or many roots.  
   **Do not** only scan the folder-opened slug if a `*code-workspace/agent-transcripts` sibling exists for the same repo token.  
   Union all discovered roots. Step 3 uses a **full tree walk** only for **`current-session`**; for **`existing-summaries`**, use **targeted paths only** (no full walk).

2. **Load incremental index**  
   Read `~/.cursor/persistent-memory/incremental-index.json`. List `~/.cursor/persistent-memory/incremental-index-*.json` archives if needed; use latest `lastProcessedAt` per transcript path when merging.

3. **Discover transcripts to process**  

   Run **one** branch below according to scope (**`existing-summaries`** vs **`current-session`**). Do **not** run the **`current-session`** tree walk when scope is **`existing-summaries`**.

   **`PERSISTENT_MEMORY_SCOPE=existing-summaries` (manual default)** — **no** full tree walk under `agent-transcripts/`, and **do not** glob **`~/.cursor/persistent-memory/summaries/*.md`** (use hook state only for the id set):  
   1. Read **`<workspace-root>/.cursor/hooks/state/persistent-memory.json`**, where **`<workspace-root>`** is the workspace folder that contains this project’s **`.cursor/hooks/`** (same cwd the Stop hook uses). If the file is missing, unreadable, or not **`version: 2`** with a **`conversations`** object, respond with a brief error outcome: ensure the Stop hook has run in this workspace (it creates v2 state) or fix the path.  
   2. For each **`conversation_id`** key in **`conversations`**: skip **`unknown`** and empty keys. Read **`lastTranscriptMtimeMs`** from the entry. **Include** the id **iff** **`lastTranscriptMtimeMs` is not null** — concretely: it is a **finite number** (the Stop hook writes transcript **mtime ms** when cadence fires; JSON **`null`**, missing field, or non-numeric → **exclude**). This matches “hook has promoted persistent save for this chat at least once.”  
   3. For each included id, under **each** transcript root from step 1, resolve **parent** transcript paths only: prefer nested **`{root}/{id}/{id}.jsonl`** if it exists, else flat **`{root}/{id}.jsonl`**. If **neither** exists under any root, **skip** that id. **Do not** add **`…/subagents/`** paths.  
   4. The **candidate list** is the **deduped** set of absolute paths from step 3. If **no** id passes step 2, or **no** path resolves under the roots, the candidate list is empty—respond with **`No session summary generated (no substantive content); index updated.`** (or one line that no **`lastTranscriptMtimeMs`**-qualified ids mapped to transcripts here). **Do not** run the subagent-inclusive tree walk below.

   **`PERSISTENT_MEMORY_SCOPE=current-session` only** — full discovery (dedupe by absolute path). **Skip** this entire subsection when scope is **`existing-summaries`**.  
   - **Nested layout (common):** each subdir named `conversation_id` with file `{transcript_root}/{conversation_id}/{conversation_id}.jsonl`.
   - **Flat layout:** some Cursor/project folders store `{transcript_root}/{conversation_id}.jsonl` directly (no subdir). Include every such `*.jsonl` at the root of `agent-transcripts/` whose basename (without `.jsonl`) looks like a conversation id (e.g. UUID). Do **not** skip these; they are the same artifact type as nested files.
   - **Subagent layout:** `.../agent-transcripts/{parent_id}/subagents/{subagent_id}.jsonl` — still **include** in the discovered path list and **mark dirty** vs the index, but these files are **Task / worker process logs** (orchestration, tool traces), not the user’s main chat. Step 4 applies the **subagent rule** before writing any user-facing summary.
   Resolve each file to its **absolute path**.

   **Current session resolution (`PERSISTENT_MEMORY_SCOPE=current-session` only)**  
   After you have the **full** candidate set from the **`current-session`** tree walk above, determine **exactly one target transcript path** for this run (do not process others):
   1. If **`transcript_path=…`** is given and points to a `*.jsonl` that lies under one of the discovered `agent-transcripts` roots (prefix match on absolute path), use that path.
   2. Else if **`conversation_id=…`** is given, use the existing candidate path whose basename (flat) or parent directory name (nested) equals that id.
   3. Else **fallback:** among all candidate `*.jsonl` paths, choose the file with the **largest** `mtimeMs`; if tied, choose the **lexicographically greatest** absolute path (deterministic). Note in the outcome that fallback was used so the user can supply `conversation_id` or `transcript_path` next time if the wrong chat was picked.

   Then **replace** the working candidate list according to scope:
   - **`PERSISTENT_MEMORY_SCOPE=existing-summaries`:** the list is **already** the set from the **`existing-summaries`** subsection—do **not** union with the tree walk or apply **`current-session`** resolution.
   - **`PERSISTENT_MEMORY_SCOPE=current-session`:** keep **only** the single target path, **if** it exists; if it does not exist or is not under the roots, respond with an error outcome and do not process other files.

   Process only paths that still need work under the incremental index:
   - transcripts **not** in the index (process full file), or
   - transcripts whose file **mtime** is newer than `index.transcripts[abs_path].mtimeMs` (process full file).

   For **`current-session`**, if the single target is already up to date in the index, respond exactly: `No session summary generated (no substantive content); index updated.` (or state that this session’s transcript had no pending incremental work) and still ensure the index on disk is consistent—do **not** scan other transcripts to “find work.”

   For **`existing-summaries`**, if the candidate list is **empty** (no **`lastTranscriptMtimeMs`**-qualified ids, no JSONL under roots, or all up to date in the index), respond with the same **`No session summary generated (no substantive content); index updated.`** outcome; do **not** fall back to a full tree walk.

4. **For each transcript that needs an update**
   - **Subagent transcripts (MUST, first check):** If the absolute path contains a path segment named **`subagents` under an `agent-transcripts` root** (e.g. `.../agent-transcripts/000c7…/subagents/0df8721a-….jsonl`), it is a **subagent or delegated worker run**, not a user “session” for memory. **Do not** read it for a narrative summary, **do not** write or update `summaries/{conversation_id}.md`, **do not** write `transcripts/{conversation_id}.jsonl.gz`, and **do not** change `sessions.md`. **Do** set `incremental-index.json` for that path to the current `mtimeMs` and `lastProcessedAt`, then **continue to the next file**. Rationale: user value lives in the **parent** thread (`.../{conversation_id}/{conversation_id}.jsonl`), not in internal task logs. **Do not** use “the subagent edited many files” as a reason to summarize; capture outcomes in the **parent** (or a non-`subagents/`) transcript.
   - **Otherwise (normal user / assistant chat transcript, not under `subagents/`):**
     - Read the **full** transcript file. Derive `conversation_id` from the path (e.g. parent dir name or filename without `.jsonl`).
     - Read existing summary from `~/.cursor/persistent-memory/summaries/{conversation_id}.md` if present.
     - Parse the transcript JSONL; extract text from `content` (type `"text"` → `text`).
     - If the content contains **substantive content** (decisions, findings, edits, references, etc.): perform **all three** of the following **in order** (never skip any):
       1. `mkdir -p ~/.cursor/persistent-memory/summaries ~/.cursor/persistent-memory/transcripts`
       2. **Write** the summary to `~/.cursor/persistent-memory/summaries/{conversation_id}.md` following **Merge and full re-synthesis (MUST)** and **Output Format**. The file MUST include a `## Transcript` section with:
          `~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz` — raw transcript (gzip). Load with `gzip -dc <path>`.
       3. **Archive transcript:** `gzip -c "<absolute_path_to_transcript.jsonl>" > ~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`
     - If the content has **no substantive content** (e.g. only a single command, no decisions/findings/edits): do **not** write or update the summary file; do **not** add/update this conversation in sessions.md; do **not** archive the transcript.
     - **Low-value command-only runs are non-substantive by default:** if the conversation is primarily executing `/persistent-memory-save` or `/persistent-memory-retrieve` and does **not** modify persistent-memory implementation or skills, treat it as no substantive content. In this case, do **not** write/update summary, do **not** update sessions.md, and do **not** archive transcript.
     - **Exception (recordable):** if the same conversation includes meaningful changes to persistent-memory behavior (for example `skills/persistent-memory-save/SKILL.md`, `agents/persistent-memory-saver.md`, `skills/persistent-memory-retrieve/SKILL.md`, `hooks/persistent-memory-stop.ts`, plugin config, or related code/docs with decisions/findings), then it is substantive and should be summarized normally.
     - **Always** for this transcript (even when no substantive content, for this non-subagent file): update `incremental-index.json` for the transcript's **absolute path** with `mtimeMs` = current file mtime (ms since epoch), `lastProcessedAt` = current ISO timestamp. Only when a summary was **written** for this conversation: upsert `sessions.md` (one **markdown table row**; **`{end}` from transcript mtime—see Session List Update**).

5. **Write back**  
   Save `incremental-index.json` and `sessions.md` after processing. **CRITICAL:** If any transcripts were processed (including those with no substantive content), you MUST update and persist the index so the next run skips them until their file mtime changes. If no transcripts needed updates or all had no substantive content, respond exactly: `No session summary generated (no substantive content); index updated.`

6. **Before completing**  
   For each conversation for which you wrote a summary, verify:
   - `summaries/{conversation_id}.md` exists, contains **exactly one** top-level `#` H1 (see **Merge and full re-synthesis (MUST)**), and contains `## Transcript` with the correct path
   - `transcripts/{conversation_id}.jsonl.gz` exists. If missing, run: `gzip -c "<abs_path_to_jsonl>" > ~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`

## Output Format

**MANDATORY.** Each summary file `~/.cursor/persistent-memory/summaries/{conversation_id}.md` MUST follow this structure:

```markdown
# {start} | {end} | {Descriptive title}

## Summary
**Single-thread:** 1–3 sentences on what was discussed and accomplished. **Multi-thread:** see **Multi-topic sessions (MUST)** below—do not compress to one thread only.

## Workspace
Project/workspace name (from transcript path `.cursor/projects/{project}/agent-transcripts/`).

## Key paths
Important paths used: project root, config files, storage dirs (e.g. `~/.cursor/persistent-memory/`).

## Transcript
`~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz` — raw transcript (gzip). Load with `gzip -dc <path>`.

## References
Links to design docs, Notion, issues, specs. Omit if none.

## Decisions
- Bullet list of decisions made.

## Key findings
- Bullet list of discoveries, root causes, insights.

## Errors & workarounds
Errors and workarounds. Omit if none.

## Files changed
- List of files modified or created.

## Git state
Branch, remote. Omit if not relevant.

## Next step
1–2 sentences for handoff (e.g. "Run tests", "Continue from X").

## Open
- Unresolved questions, TODOs.

## Tags
#project-<workspace-slug> #tag1 #tag2
```

### Merge and full re-synthesis (MUST)

- **One file, one H1:** `summaries/{conversation_id}.md` contains **exactly one** canonical `# {start} | {end} | {Descriptive title}` line at the top, then `##` sections. **Forbidden:** appending a **second** full `# …` line or a second copy of the entire template in the same file (e.g. under “Incremental merge” / “Superseded / incremental re-scan”). **Legacy** files on disk with duplicate `#` blocks: on the next write, **replace the entire file** with a single re-synthesized body from the **current full JSONL**; do not preserve stale appended blocks.
- **Preferred write path:** On every save that updates the summary, **re-read the full JSONL** and **rewrite** the complete markdown in one pass (satisfies all sections, multi-thread rules, and tag re-derivation). The existing `summaries/{conversation_id}.md` (if any) is **context only**—to spot threads or prior wording worth preserving—not a vessel for stacked documents.
- **H1 title source:** The **Descriptive title** (third H1 segment) must summarize **this** `conversation_id`’s work only. **Forbidden** as the title: a raw `@/path/.../other-uuid.jsonl` string or another **conversation’s** id/path used as a prior transcript *attachment* in the first user turn; mention those in **## Key paths** or a short **## Summary** clause if they matter, not in the H1.
- **Stub pass:** If a re-scan would produce only placeholder “Session captured from JSONL / see gzip for tools”-style text with no real `## Decisions` / `## Key findings` / work bullets, and the file **already** has a substantive top section: **do not** append; **do not** replace the good version with a stub. If the *only* content in the file is stub, skip summary write and index-only per "When to Skip" if appropriate.

- Use `##` for sections; omit sections with no content. At minimum keep `# title`, `## Summary`, `## Transcript` (with archive path), `## Tags`. **Always include `## Transcript`** with the `.jsonl.gz` path so retrieval can load the raw transcript.
- **Summary H1 — `{start}` and `{end}`:** Use the **same semantics and values** as the **Start** and **End** fields in `sessions.md` (see Session List Update). Format both as `YYYY-MM-DDTHHMM` (local wall time derived from the chosen epoch fields). **`{start}`:** transcript `.jsonl` file birth time (e.g. `stat -c %W` on Linux, `stat -f %B` on macOS); if birth is unknown or `0`, use the transcript file **mtime** for both `{start}` and `{end}`. **`{end}`:** transcript `.jsonl` file **mtime** (last modification of the conversation artifact), e.g. `stat -c %Y` then convert to `YYYY-MM-DDTHHMM`—**not** the wall-clock time when running save, and **not** "summary last rewritten." On each full re-synthesis, recompute `{end}` from the current transcript mtime; keep `{start}` from birth unless birth was never available (then use mtime for start as above).
- **Descriptive title:** The third segment after `{start} | {end} |`. **Scale length to the session**—there is **no** minimum or target character count. A **small** change or narrow question can use a **short** title if it is still specific; a **long** investigation should use a **longer** title with enough clauses (commas or semicolons) to separate topics, outcomes, and differentiators. Judge by **practice**: include what a future you needs to pick this row out of similar ones (topic, outcome, ticket/CL/file/skill when relevant). **Do not** pad length; **do not** omit important detail just to stay brief. Avoid vague one-liners when the transcript contains concrete specifics (e.g. prefer "SurfaceFlinger parallel_refresh RE log, drawSummary fix, XHMI-12345" over "SF log analysis" when that is what happened). This whole output format applies only to **user/assistant chat** transcripts; **do not** write any of it for **`subagents/`** JSONL (index-only per step 4).
- **`## References` (hygiene):** List **durable, human-meaningful** links: issue/MR, main Notion task, design doc. **Forbidden:** raw dumps of every URL the model saw, placeholder tokens (`https://...`, `https://`+backtick, GitLab **API** template lines), and near-**duplicate** Notion URLs that differ only by id noise unless each is a distinct *decision-relevant* page. Prefer one canonical link per entity.
- **`## Key findings` (hygiene):** **Session** insights (root cause, why a measure was chosen, a bug you proved). **Forbidden** pasting long **product rules** / **MCP tool schema** / default **command** bodies from context unless the session is *about* editing those files; one-line file pointers are enough.
- **`## Next step` and `## Open`:** After full re-synthesis, these must **match the latest transcript** (e.g. do not say "run /reflect" if the transcript already completed it—move to **## Open** or a follow-up *unless* a later turn reopened work). Remove stale “resume from last message / grep gzip” boilerplate if the top **## Summary** is substantive.
- **Multi-topic sessions (MUST):** One `conversation_id` can contain **several** substantive threads (e.g. Notion **Task A** then **Task B**, or Jira import then a different **`/van`**). This is **not** optional to capture.
  1. **Detect:** While reading the **full** transcript, list every **distinct** substantive thread. Strong signals include: different **Notion Task ID** / **`Task \d+`** / **Jira keys (`XHMI-…`, `PROJ-…`)** / separate **Memory Bank** `taskId` handoffs / unrelated **MR or branch** goals. A later long block (e.g. **`/van`**) does **not** erase earlier work.
  2. **H1 title:** If **two or more** such threads exist, the descriptive title **MUST** name **each** major thread (use clauses: task ids, Jira keys, or unmistakable keywords). **Forbidden:** a title that only reflects the **last** thread when an earlier thread had substantive outcomes (created tasks, failed commands, decisions, file edits).
  3. **`## Summary`:** If multi-topic: use a **short bolded line per thread** (e.g. `**Task 1440 / XHMI-176918:** …` then `**Task 1438 /van:** …`) **or** `###` subheadings under `## Summary`—**minimum one sentence per thread** with concrete outcome. **Forbidden:** collapsing to a single paragraph that mentions only one task or one ticket when the transcript contains more.
  4. **Sections (`## References` through `## Next step`):** When threads differ, **prefix bullets** with the task id or Jira key, **or** use a one-line **subsection heading** per thread so retrieve/`grep` finds every id. Do not drop an earlier thread’s references or next actions.
  5. **Topic coverage (replaces ad-hoc incremental append):** When a prior summary file exists, **re-scan the full JSONL** and **merge by rewriting** the full document. If a thread was **missing** from the old summary, **include** it in the new `## Summary` and tagged sections. If a later turn **supersedes** an earlier decision, keep one paragraph with “—superseded by …” in **## Decisions** or **## Summary**; do **not** stack a second full H1+template below the first.
  6. **`## Tags`:** Topic tags (max 3 after `#project-…`) are scarce—prefer tags that improve **keyword retrieve** for **distinct** work (e.g. `#task-1440`, `#xhmi-176918`) over generic tags when the transcript contains multiple external ids.
- **Do not record save/retrieve as session themes:** Do **not** include `persistent-memory-save` or `persistent-memory-retrieve` in the title or Summary when they merely describe the user running those commands—they are meta-actions, not session themes. Focus on the actual work (e.g. "Daily summary yesterday (Mar 18), Logs 260318" not "...persistent-memory-save"). **Exception:** Only mention them when the session is *about* the skill/plugin (e.g. modifying SKILL.md, debugging save behavior, adding command-noise guard).
- In `## Transcript`, replace `{conversation_id}` with the actual conversation id for this session.
- **Tags — project first, then topics:**
  1. **Project tag (mandatory when path is known):** From this transcript’s **absolute path**, take the **Cursor project folder name** — the single path segment **immediately above** `agent-transcripts` (e.g. `.../.cursor/projects/<workspace-folder>/agent-transcripts/...` → `<workspace-folder>`). **Canonical dirname (folder vs `.code-workspace`):** Cursor uses `<base-slug>` when the window is opened on a folder, and typically `<base-slug>-<workspace-file-stem>-code-workspace` when opened via a `.code-workspace` file (same repo, different folder name). So **before** character normalization, compute **`canonical_dirname`**:
     - If `<workspace-folder>` **ends with** `-code-workspace` (case-insensitive compare for this suffix only): let **`inner`** = that folder name with the `-code-workspace` suffix removed. Split **`inner`** on `-` into segments (non-empty). If **`len(segments) < 2`**, set **`canonical_dirname` = `inner`** (no stem/base split). Otherwise assume **`inner`** = `<base-slug>` + `-` + `<workspace-stem>` where **`<workspace-stem>`** is one or more trailing segments; we don’t read the `.code-workspace` file — we **infer** stem length:
       1. For **`k` = 1, 2, …** up to **`len(segments) - 1`** (need at least one segment left for **`base`**): let **`base`** = join the **first** `len(segments) - k` segments with `-` (treat the **last `k`** segments as the inferred workspace stem).
       2. Let **`probe`** = `~/.cursor/projects/{base}/agent-transcripts` (expand home). If **`probe`** exists and is a **directory**, set **`canonical_dirname` = `base`** and **stop**.
       3. If no **`k`** produced a hit, **fall back** to **`k` = 1** only: **`canonical_dirname`** = join of all segments except the last (same as the original single-segment stem rule).
     - Otherwise set **`canonical_dirname`** = `<workspace-folder>` unchanged.
     - **Notes:** Step 2 ties the tag to a **real** folder-opened Cursor project on disk when one exists, which fixes many **hyphenated** workspace file stems (`my-ws.code-workspace` → try longer stems until `base` matches a sibling). **Ambiguity:** if **`k` = 1** already finds a directory but it is the **wrong** project (unrelated slug that happens to be a prefix), the tag can still be wrong — rare. **No sibling:** if the user **only** ever opened the repo via the workspace window, no `.../projects/{base}/agent-transcripts` may exist; the fallback **`k` = 1** still applies a deterministic tag.
     Build **`#project-<slug>`** where `<slug>` is **`canonical_dirname` normalized:** lowercase; replace `_` with `-`; replace any run of characters outside `[a-z0-9-]` with a single `-`; collapse repeated `-`; trim leading/trailing `-`. If the path does not contain `.cursor/projects/` / `agent-transcripts` or normalization yields empty, use **`#project-unknown`**. This tag must be **first** in `## Tags` and in the **Tags** cell of `sessions.md` so retrieve can filter or prefer “this project” by matching `#project-…` **whether the chat lived under folder or workspace-window** the same repo.
  2. **Semantic tags:** After the project tag, add the **most relevant** topic tags for retrieval—**at most 3**. Use lowercase with hyphens (e.g. `#surfaceflinger`, `#parallel-refresh`). Prioritize topic/domain, key technology, and distinctive outcome. **Re-evaluate on every run:** when processing a transcript (including re-reads), derive these from the **full** transcript content; do not carry over or merge old topic tags.
- **Merge rule (updated):** Read the existing `summaries/{conversation_id}.md` (if any) for context, then **produce a single new file body** that follows **Merge and full re-synthesis (MUST)**. **Do not** “append a second full template” to the file. When decisions are superseded, **annotate in place** in the rewritten `## Decisions` / `## Summary`. **Exception:** `## Tags` are re-derived from path + full transcript on every write, not merge-appended.

## Incremental Index

File: `~/.cursor/persistent-memory/incremental-index.json`

Same shape as continual-learning index: key by transcript **absolute path**, track **mtime** and last-processed time.

```json
{
  "version": 1,
  "transcripts": {
    "/abs/path/to/agent-transcripts/{conversation_id}/{conversation_id}.jsonl": {
      "mtimeMs": 1730000000000,
      "lastProcessedAt": "2026-03-11T12:50:00.000Z"
    }
  }
}
```

- After processing a transcript, set/update that path's `mtimeMs` (file mtime in ms) and `lastProcessedAt` (ISO); preserve other entries. Remove entries for files that no longer exist.
- When resolving "already processed" state, consider `incremental-index-*.json` archives and use the latest `lastProcessedAt` per transcript path if present in multiple files.

## Transcript Archive

Path: `~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`

**Tied to summary write:** Whenever you write `summaries/{conversation_id}.md`, you MUST also create the transcript archive (workflow step 4.3). Compress and save the raw transcript so it can be looked up after syncing across devices. Steps:

1. Ensure the directory exists: `mkdir -p ~/.cursor/persistent-memory/transcripts/`
2. Compress and write (overwrites if exists): `gzip -c <absolute_path_to_transcript.jsonl> > ~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`

- Do **not** archive when the transcript is skipped (empty, unreadable, or no substantive content).
- Use the same `conversation_id` as the summary filename (without `.md`).

## Session List Update

File: `~/.cursor/persistent-memory/sessions.md`

sessions.md lists **conversations that have summary content** (i.e. a written `{conversation_id}.md`). Update it only when you write or update a summary for a conversation; do not add/update a line when the run produced no substantive content for that conversation.

**Format — markdown sheet (GFM table):** The file is a single table, not pipe-separated plain lines.

1. Optional heading: `# Persistent memory sessions` (keep if present).
2. Blank line, then header row: `| ID | Start | End | Title | Tags |`
3. Separator row: `| --- | --- | --- | --- | --- |`
4. One data row per session (below the separator). **Table order:** After any insert or replace, **sort all data rows by the `End` column descending** (newest transcript mtime first). Parse `End` as `YYYY-MM-DDTHHMM` (zero-padded fields; lexicographic order matches chronological). **Tie-breakers:** if two rows share the same `End`, sort by `Start` descending; if still tied, sort by `ID` ascending for a stable order.

**Each data row** (five cells):

`| {conversation_id[:8]} | {start} | {end} | {title} | {tags} |`

- **Start:** Transcript file birth time (e.g. `stat -c %W` on Linux, `stat -f %B` on macOS; format `YYYY-MM-DDTHHMM`). If unavailable or `0`, use transcript **mtime** (same as End). Must match the **first** segment of the summary file H1 (`# {start} | {end} | …`).
- **End:** Transcript `.jsonl` **mtime** (last modification of the transcript file), format `YYYY-MM-DDTHHMM`—represents when the conversation artifact last changed, **not** when the summary was saved. Must match the **second** segment of the summary H1. On each summary write, set **End** from the transcript's current mtime (and refresh `{end}` in the H1 accordingly).
- **Title:** The **descriptive title only**—the **third** segment of the summary H1 (not the full `#` line). Copy it **verbatim** from the summary (same length and wording). It must distinguish similar sessions **for the amount of work in that chat** (see Output Format **Descriptive title**).
- **Tags:** Same as the summary `## Tags`: **`#project-<slug>` first** (canonical dirname from this transcript’s path — folder vs `.code-workspace` — see Output Format), then **up to 3** semantic topic tags, space-separated (e.g. `#project-mnt-2tb-monalisadesign-gloable #surfaceflinger #parallel-refresh`).
- **Cell escaping:** If `{title}` or `{tags}` contains a literal `|` (pipe), write it as `\|` inside the cell so the table stays valid.
- **Upsert:** Load all existing data rows. Replace the row whose **ID** cell equals `{conversation_id[:8]}` with the new cells, or **append** one row if no match. Then **rewrite the full table**: heading, header, separator, then **all data rows sorted by `End` descending** (then `Start` descending, then `ID` ascending per tie-breakers above). Do not duplicate the table or leave rows out of order.
- **Legacy:** If you encounter an old plain-line file (`id | start | end | title | tags` without leading `|`), rewrite the whole file to this table format on the next save.

## Transcript Parsing

- JSONL: each line `{"role":"user"|"assistant","message":{"content":[...]}}`. Extract text from `content` (type `"text"` → `text`).
- Process the full transcript for each file that needs an update (file-level granularity, same as continual-learning).
- Prioritize: workspace name, key paths, references, git state, errors/workarounds, next-step cues.
- **Title:** Do not build the H1 from **another** session’s id embedded in an `@/…/other-uuid.jsonl` path; that is *input context* for *this* chat, not a second session to title as if it were `conversation_id`.

## When to Skip (per conversation)

- **Subagent process log (`/subagents/` in path):** Same as “no user summary” by policy—**never** create or update `summaries/`, `transcripts/*.gz`, or `sessions.md` for these paths; **only** update the index so future runs do not re-queue them. If a mistaken summary/row was created in the past, removal is **optional** (user-asked maintenance); standard runs do not bulk-delete.
- **Empty or unreadable transcript:** Do not create a summary file. Update index for that transcript path with current `mtimeMs` and `lastProcessedAt` = now; do not add/update that conversation in sessions.md.
- **No substantive content** in the transcript (e.g. only a single command, no decisions/findings/edits): Do **not** write or update the summary file; do **not** add/update that conversation in sessions.md (sessions.md represents summary content). **Must still** update `incremental-index.json` for that transcript path (and save it in step 5) so the next run skips it until the file changes.
- **Command-noise guard:** Treat pure `/persistent-memory-save` or `/persistent-memory-retrieve` execution logs as **no substantive content** unless the conversation also contains meaningful persistent-memory skill/code/config modifications or durable decisions/findings.

If **no** transcripts needed updates or **all** fell into the skip cases above, respond exactly: `No session summary generated (no substantive content); index updated.`
