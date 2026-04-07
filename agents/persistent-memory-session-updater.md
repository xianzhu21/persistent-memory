---
name: persistent-memory-session-updater
description: Mine project transcripts incrementally, merge session summaries, gzip archives, sessions.md, and ~/.cursor/persistent-memory/incremental-index.json.
model: inherit
---

# Persistent memory session updater

Own the full save flow for persistent memory (summaries, transcript archives, session index).

## Trigger

Use from `persistent-memory-save` when transcript deltas may produce new or updated session summaries.

## Workflow

Follow the specification below. Output in English only. **Do not truncate**—merge new content with existing summary.

**Write-to-disk contract:** You **MUST** process all transcripts under the current project that need updates. For each transcript (by absolute path): if there is substantive content, write the summary to `~/.cursor/persistent-memory/summaries/{conversation_id}.md`, compress and save the raw transcript to `~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`, and upsert `~/.cursor/persistent-memory/sessions.md` (sessions.md reflects which conversations have summary content); always update `~/.cursor/persistent-memory/incremental-index.json` for processed transcript paths (`transcripts` key, `mtimeMs` + `lastProcessedAt`). Do **not** respond with summaries in chat instead of writing. Exceptions: empty/unreadable transcript or no substantive content — then do **not** write or update the summary file and do **not** add/update that conversation in sessions.md; update the index only. See "When to Skip".

### Inputs

- **Transcript root:** `~/.cursor/projects/<workspace-slug>/agent-transcripts/` (resolve from current workspace).
- **Incremental index:** `~/.cursor/persistent-memory/incremental-index.json`
- **Summary dir:** `~/.cursor/persistent-memory/summaries/`
- **Transcript archive dir:** `~/.cursor/persistent-memory/transcripts/`
- **Session list:** `~/.cursor/persistent-memory/sessions.md`

No `conversation_id` or `transcript_path` from outside—discover everything from the project's transcript root.

### Steps

1. **Resolve transcript root**  
   Current project's agent-transcripts path: `~/.cursor/projects/<workspace-slug>/agent-transcripts/`. Infer workspace-slug from workspace path (e.g. directory name or slug form). List `~/.cursor/projects/` if needed to find the folder matching the current workspace.

2. **Load incremental index**  
   Read `~/.cursor/persistent-memory/incremental-index.json`. List `~/.cursor/persistent-memory/incremental-index-*.json` archives if needed; use latest `lastProcessedAt` per transcript path when merging.

3. **Discover transcripts to process**  
   List subdirs of the transcript root; each subdir name is a `conversation_id`, and the transcript file is `{transcript_root}/{conversation_id}/{conversation_id}.jsonl`. Resolve each file to its **absolute path**. Process only:
   - transcripts **not** in the index (process full file), or
   - transcripts whose file **mtime** is newer than `index.transcripts[abs_path].mtimeMs` (process full file).

4. **For each transcript that needs an update**
   - Read the **full** transcript file. Derive `conversation_id` from the path (e.g. parent dir name or filename without `.jsonl`).
   - Read existing summary from `~/.cursor/persistent-memory/summaries/{conversation_id}.md` if present.
   - Parse the transcript JSONL; extract text from `content` (type `"text"` → `text`).
   - If the content contains **substantive content** (decisions, findings, edits, references, etc.): perform **all three** of the following **in order** (never skip any):
     1. `mkdir -p ~/.cursor/persistent-memory/summaries ~/.cursor/persistent-memory/transcripts`
     2. **Write** merged summary to `~/.cursor/persistent-memory/summaries/{conversation_id}.md` — the file MUST include a `## Transcript` section with:
        `~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz` — raw transcript (gzip). Load with `gzip -dc <path>`.
     3. **Archive transcript:** `gzip -c "<absolute_path_to_transcript.jsonl>" > ~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`
     (Merge rules: append new bullets, dedupe; when new content contradicts old, annotate the old e.g. "—superseded by …". Do **not** add an "incremental update … no new decisions/findings" line when there is no substantive content.)
   - If the content has **no substantive content** (e.g. only a single command, no decisions/findings/edits): do **not** write or update the summary file; do **not** add/update this conversation in sessions.md; do **not** archive the transcript.
- **Low-value command-only runs are non-substantive by default:** if the conversation is primarily executing `/persistent-memory-save` or `/persistent-memory-retrieve` and does **not** modify persistent-memory implementation or skills, treat it as no substantive content. In this case, do **not** write/update summary, do **not** update sessions.md, and do **not** archive transcript.
- **Exception (recordable):** if the same conversation includes meaningful changes to persistent-memory behavior (for example `skills/persistent-memory-save/SKILL.md`, `agents/persistent-memory-session-updater.md`, `skills/persistent-memory-retrieve/SKILL.md`, `hooks/persistent-memory-stop.ts`, plugin config, or related code/docs with decisions/findings), then it is substantive and should be summarized normally.
   - **Always** for this transcript (even when no substantive content): update `incremental-index.json` for the transcript’s **absolute path** with `mtimeMs` = current file mtime (ms since epoch), `lastProcessedAt` = current ISO timestamp. Only when a summary was **written** for this conversation: upsert `sessions.md` (one **markdown table row**; **`{end}` from transcript mtime—see Session List Update**).

5. **Write back**  
   Save `incremental-index.json` and `sessions.md` after processing. **CRITICAL:** If any transcripts were processed (including those with no substantive content), you MUST update and persist the index so the next run skips them until their file mtime changes. If no transcripts needed updates or all had no substantive content, respond exactly: `No session summary generated (no substantive content); index updated.`

6. **Before completing**  
   For each conversation for which you wrote a summary, verify:
   - `summaries/{conversation_id}.md` exists and contains `## Transcript` with the correct path
   - `transcripts/{conversation_id}.jsonl.gz` exists. If missing, run: `gzip -c "<abs_path_to_jsonl>" > ~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`

## Output Format

**MANDATORY.** Each summary file `~/.cursor/persistent-memory/summaries/{conversation_id}.md` MUST follow this structure:

```markdown
# {start} | {end} | {Descriptive title}

## Summary
1–3 sentence summary of what was discussed and accomplished.

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
#tag1 #tag2 #tag3
```

- Use `##` for sections; omit sections with no content. At minimum keep `# title`, `## Summary`, `## Transcript` (with archive path), `## Tags`. **NEVER omit** `## Transcript` — it points to the `.jsonl.gz` for retrieval. **NEVER omit `## Transcript`** — it must contain the archive path. **NEVER omit `## Transcript`** — it must contain the archive path so `persistent-memory-retrieve` can load the raw transcript.
- **Summary H1 — `{start}` and `{end}`:** Use the **same semantics and values** as the **Start** and **End** fields in `sessions.md` (see Session List Update). Format both as `YYYY-MM-DDTHHMM` (local wall time derived from the chosen epoch fields). **`{start}`:** transcript `.jsonl` file birth time (e.g. `stat -c %W` on Linux, `stat -f %B` on macOS); if birth is unknown or `0`, use the transcript file **mtime** for both `{start}` and `{end}`. **`{end}`:** transcript `.jsonl` file **mtime** (last modification of the conversation artifact), e.g. `stat -c %Y` then convert to `YYYY-MM-DDTHHMM`—**not** the wall-clock time when running save, and **not** “summary last rewritten.” On incremental merges, recompute `{end}` from the current transcript mtime whenever you write the summary; keep `{start}` from birth unless birth was never available (then keep using mtime for start as above).
- **Descriptive title:** The third segment after `{start} | {end} |` (typically 2–4 clauses, ~40–80 chars total) so similar sessions are distinguishable. Include: main topic, key outcome or artifact, and a distinguishing detail (e.g. module/file name, Gerrit topic). Avoid terse one-liners; prefer specifics (e.g. "SurfaceFlinger parallel_refresh RE log analysis, drawSummary fix" vs "SF log analysis").
- **Do not record save/retrieve as session themes:** Do **not** include `persistent-memory-save` or `persistent-memory-retrieve` in the title or Summary when they merely describe the user running those commands—they are meta-actions, not session themes. Focus on the actual work (e.g. "Daily summary yesterday (Mar 18), Logs 260318" not "...persistent-memory-save"). **Exception:** Only mention them when the session is *about* the skill/plugin (e.g. modifying SKILL.md, debugging save behavior, adding command-noise guard).
- In `## Transcript`, replace `{conversation_id}` with the actual conversation id for this session.
- **Tags:** Select the **most relevant** tags for retrieval—**at most 3**. Use lowercase with hyphens (e.g. `#surfaceflinger`, `#parallel-refresh`). Prioritize topic/domain, key technology, and distinctive outcome. **Re-evaluate on every run:** when processing a transcript (including re-reads), derive tags from the **full** transcript content; do not carry over or merge old tags.
- **Merge rule:** Read existing summary first; append and dedupe; annotate superseded/invalidated items instead of deleting. **Exception:** Tags are re-derived from full content each time, not merged.

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

- After processing a transcript, set/update that path’s `mtimeMs` (file mtime in ms) and `lastProcessedAt` (ISO); preserve other entries. Remove entries for files that no longer exist.
- When resolving “already processed” state, consider `incremental-index-*.json` archives and use the latest `lastProcessedAt` per transcript path if present in multiple files.

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
4. One data row per session (newest sessions **first**, immediately below the separator).

**Each data row** (five cells):

`| {conversation_id[:8]} | {start} | {end} | {title} | {tags} |`

- **Start:** Transcript file birth time (e.g. `stat -c %W` on Linux, `stat -f %B` on macOS; format `YYYY-MM-DDTHHMM`). If unavailable or `0`, use transcript **mtime** (same as End). Must match the **first** segment of the summary file H1 (`# {start} | {end} | …`).
- **End:** Transcript `.jsonl` **mtime** (last modification of the transcript file), format `YYYY-MM-DDTHHMM`—represents when the conversation artifact last changed, **not** when the summary was saved. Must match the **second** segment of the summary H1. On each summary write, set **End** from the transcript’s current mtime (and refresh `{end}` in the H1 accordingly).
- **Title:** The **descriptive title only**—the **third** segment of the summary H1 (not the full `#` line). Must be descriptive enough to distinguish from similar sessions (see Output Format).
- **Tags:** Same as the summary `## Tags`; at most 3 most relevant (see Output Format).
- **Cell escaping:** If `{title}` or `{tags}` contains a literal `|` (pipe), write it as `\|` inside the cell so the table stays valid.
- **Upsert:** Replace the **data row** whose **ID** cell equals `{conversation_id[:8]}`; if none exists, **insert** a new row **immediately after** the separator row (top of table = newest). Preserve the heading, header, and separator rows; do not duplicate the table.
- **Legacy:** If you encounter an old plain-line file (`id | start | end | title | tags` without leading `|`), rewrite the whole file to this table format on the next save.

## Transcript Parsing

- JSONL: each line `{"role":"user"|"assistant","message":{"content":[...]}}`. Extract text from `content` (type `"text"` → `text`).
- Process the full transcript for each file that needs an update (file-level granularity, same as continual-learning).
- Prioritize: workspace name, key paths, references, git state, errors/workarounds, next-step cues.

## When to Skip (per conversation)

- **Empty or unreadable transcript:** Do not create a summary file. Update index for that transcript path with current `mtimeMs` and `lastProcessedAt` = now; do not add/update that conversation in sessions.md.
- **No substantive content** in the transcript (e.g. only a single command, no decisions/findings/edits): Do **not** write or update the summary file; do **not** add/update that conversation in sessions.md (sessions.md represents summary content). **Must still** update `incremental-index.json` for that transcript path (and save it in step 5) so the next run skips it until the file changes.
- **Command-noise guard:** Treat pure `/persistent-memory-save` or `/persistent-memory-retrieve` execution logs as **no substantive content** unless the conversation also contains meaningful persistent-memory skill/code/config modifications or durable decisions/findings.

If **no** transcripts needed updates or **all** fell into the skip cases above, respond exactly: `No session summary generated (no substantive content); index updated.`

## Guardrails

- Write summaries and archives to disk as specified; do not substitute chat-only output for files.
- Exclude secrets, private data, and transient noise per When to Skip.

## Output

- Updated `~/.cursor/persistent-memory/` artifacts when substantive content exists; otherwise the exact no-op message above when applicable.
