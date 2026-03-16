---
name: persistent-memory-save
description: When triggered by Stop hook or /persistent-memory-save, incrementally update session summaries from the current project's transcripts; merge and write to ~/.cursor/persistent-memory/summaries/{conversation_id}.md and update sessions.md. No extra context required.
---

# Persistent Memory Save

Incrementally update structured session summaries from the **current project's** agent transcripts and persist for `persistent-memory-retrieve`. Output in English only. **Do not truncate**—merge new content with existing summary.

**Write-to-disk contract:** When this skill runs, you **MUST** process all transcripts under the current project that need updates. For each transcript (by absolute path): if there is substantive content, write the summary to `~/.cursor/persistent-memory/summaries/{conversation_id}.md`, compress and save the raw transcript to `~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`, and upsert `~/.cursor/persistent-memory/sessions.md` (sessions.md reflects which conversations have summary content); always update `~/.cursor/persistent-memory/incremental-index.json` for processed transcript paths (`transcripts` key, `mtimeMs` + `lastProcessedAt`). Do **not** respond with summaries in chat instead of writing. Exceptions: empty/unreadable transcript or no substantive content — then do **not** write or update the summary file and do **not** add/update that conversation in sessions.md; update the index only. See "When to Skip".

## Inputs

- **Transcript root:** `~/.cursor/projects/<workspace-slug>/agent-transcripts/` (resolve from current workspace).
- **Incremental index:** `~/.cursor/persistent-memory/incremental-index.json`
- **Summary dir:** `~/.cursor/persistent-memory/summaries/`
- **Transcript archive dir:** `~/.cursor/persistent-memory/transcripts/`
- **Session list:** `~/.cursor/persistent-memory/sessions.md`

No `conversation_id` or `transcript_path` from outside—discover everything from the project's transcript root.

## Workflow

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
   - If the content contains **substantive content** (decisions, findings, edits, references, etc.): ensure `~/.cursor/persistent-memory/summaries/` exists (`mkdir -p`), merge (append new bullets, dedupe; when new content contradicts old, annotate the old e.g. "—superseded by …"), then **write** merged summary to `~/.cursor/persistent-memory/summaries/{conversation_id}.md` (see Output Format). **Then archive the raw transcript** (see Transcript Archive): compress the source `.jsonl` with gzip and write to `~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz` (overwrites if exists). Do **not** add an "incremental update … no new decisions/findings" line to the summary when there is no substantive content.
   - If the content has **no substantive content** (e.g. only a single command, no decisions/findings/edits): do **not** write or update the summary file; do **not** add/update this conversation in sessions.md; do **not** archive the transcript.
   - **Always** for this transcript (even when no substantive content): update `incremental-index.json` for the transcript’s **absolute path** with `mtimeMs` = current file mtime (ms since epoch), `lastProcessedAt` = current ISO timestamp. Only when a summary was **written** for this conversation: upsert `sessions.md` (line `{conversation_id[:8]} | {start} | {end} | {title} | {tags}`; end = current time when saving).

5. **Write back**  
   Save `incremental-index.json` and `sessions.md` after processing. **CRITICAL:** If any transcripts were processed (including those with no substantive content), you MUST update and persist the index so the next run skips them until their file mtime changes. If no transcripts needed updates or all had no substantive content, respond exactly: `No session summary generated (no substantive content); index updated.`

## Output Format

**MANDATORY.** Each summary file `~/.cursor/persistent-memory/summaries/{conversation_id}.md` MUST follow this structure:

```markdown
# {YYYY-MM-DDTHH:MM} | {Short title}

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

- Use `##` for sections; omit sections with no content. At minimum keep `# title`, `## Summary`, `## Transcript`, `## Tags`.
- In `## Transcript`, replace `{conversation_id}` with the actual conversation id for this session.
- Use lowercase tags with hyphens (e.g. `#surfaceflinger`, `#parallel-refresh`).
- **Merge rule:** Read existing summary first; append and dedupe; annotate superseded/invalidated items instead of deleting.

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

When a summary is **written** for a conversation, compress and save the raw transcript so it can be looked up after syncing across devices. Steps:

1. Ensure the directory exists: `mkdir -p ~/.cursor/persistent-memory/transcripts/`
2. Compress and write (overwrites if exists): `gzip -c <absolute_path_to_transcript.jsonl> > ~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz`

- Do **not** archive when the transcript is skipped (empty, unreadable, or no substantive content).
- Use the same `conversation_id` as the summary filename (without `.md`).

## Session List Update

File: `~/.cursor/persistent-memory/sessions.md`

sessions.md lists **conversations that have summary content** (i.e. a written `{conversation_id}.md`). Update it only when you write or update a summary for a conversation; do not add/update a line when the run produced no substantive content for that conversation.

Each line: `{conversation_id[:8]} | {start} | {end} | {title} | {tags}`

- **Start:** Transcript file birth time (e.g. `stat -c %W` on Linux, `stat -f %B` on macOS; format `YYYY-MM-DDTHHMM`). If unavailable, use end.
- **End:** Current time when saving, format `YYYY-MM-DDTHHMM`.
- Upsert: replace line starting with `{conversation_id[:8]}` or prepend if missing (newest at top).

## Transcript Parsing

- JSONL: each line `{"role":"user"|"assistant","message":{"content":[...]}}`. Extract text from `content` (type `"text"` → `text`).
- Process the full transcript for each file that needs an update (file-level granularity, same as continual-learning).
- Prioritize: workspace name, key paths, references, git state, errors/workarounds, next-step cues.

## When to Skip (per conversation)

- **Empty or unreadable transcript:** Do not create a summary file. Update index for that transcript path with current `mtimeMs` and `lastProcessedAt` = now; do not add/update that conversation in sessions.md.
- **No substantive content** in the transcript (e.g. only a single command, no decisions/findings/edits): Do **not** write or update the summary file; do **not** add/update that conversation in sessions.md (sessions.md represents summary content). **Must still** update `incremental-index.json` for that transcript path (and save it in step 5) so the next run skips it until the file changes.

If **no** transcripts needed updates or **all** fell into the skip cases above, respond exactly: `No session summary generated (no substantive content); index updated.`
