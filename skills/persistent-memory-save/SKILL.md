---
name: persistent-memory-save
description: When triggered by Stop hook or when user types /persistent-memory-save, incrementally update session summary from transcript, merge with existing, write to ~/.cursor/persistent-memory/{conversation_id}.md and update sessions.md.
---

# Persistent Memory Save

Incrementally update a structured summary from the transcript and persist for `persistent-memory-retrieve`. Output in English only. **Do not truncate**—merge new content with existing summary.

## Manual invocation (/persistent-memory-save)

When the user types `/persistent-memory-save` (no followup_message): locate the current session transcript—path format `{workspace}/.cursor/projects/{project}/agent-transcripts/{conversation_id}/{conversation_id}.jsonl`. List `agent-transcripts` subdirs, pick the most recently modified `.jsonl` (or infer from context). Extract `conversation_id` from the path; extract `{project}` as **Workspace** for the summary. Read `incremental-index.json` (and `incremental-index-YYYY-MM-DDTHHMMSS.json` archives if needed) for `lastProcessedLineCount`; process from that line to end (or full transcript if none). Merge, write, update index and sessions.md.

## Inputs (from followup_message or manual)

- `transcript_path`: Path to the current session's agent-transcript JSONL file
- `conversation_id`: UUID for this session (use as filename)
- **Incremental mode**: The message may specify "Only process transcript lines from line index X to Y" — in that case:
  - Read existing summary from `~/.cursor/persistent-memory/{conversation_id}.md` if it exists
  - Parse the transcript and process **only** lines from index X through Y (0-based, inclusive)
  - **Always read existing summary first.** New transcript may contradict prior conclusions
  - Merge: append new bullets, dedupe. When new content contradicts old, **annotate the old** (e.g. "—later superseded by X", "—invalidated: reason") instead of deleting; keeps change history
  - After writing, update `~/.cursor/persistent-memory/incremental-index.json`: set `conversations["{conversation_id}"].lastProcessedLineCount` = Y+1
- **Full mode** (no start line specified): Process entire transcript, create new summary, set lastProcessedLineCount to total lines.
- **No new lines** (startLine >= totalLines): Skip content extraction; if index exists, update lastProcessedLineCount to totalLines for consistency. Respond: No new content to add.

## Output Format

Write the summary to `~/.cursor/persistent-memory/{conversation_id}.md`:

```markdown
# {YYYY-MM-DDTHH:MM} | {Short title}

## Summary
1–3 sentence summary of what was discussed and accomplished.

## Workspace
Project/workspace name (e.g. from transcript path `.cursor/projects/{project}/agent-transcripts/`). Helps handoff: agent on another device knows which project this context belongs to.

## Key paths
Important paths used: project root, config files, storage dirs (e.g. `~/.cursor/persistent-memory/`), any paths user or assistant referred to.

## References
Links to design docs, Notion pages, issues, specs, or external resources mentioned. Omit if none.

## Decisions
- Bullet list of decisions made (architecture, approach, tool choice, etc.)

## Key findings
- Bullet list of discoveries, root causes, insights

## Errors & workarounds
Errors encountered during debugging, build failures, or unexpected behavior; workarounds or fixes applied. Omit if none.

## Files changed
- List of files modified or created

## Git state
Branch, remote, last push if mentioned. Omit if not relevant.

## Next step
1–2 sentences: when handoff to another device, what should the agent do first? (e.g. "Run tests", "Continue from X", "Review PR")

## Open
- Unresolved questions, TODOs, follow-ups

## Tags
#tag1 #tag2 #tag3
```

- **Headings**: Top-level title uses #; section headers use ##. Omit section headers that have no content.
- Use lowercase tags with hyphens (e.g. `#surfaceflinger`, `#parallel-refresh`). Infer from conversation content.
- **Merge rule**: Read existing summary first. When new content contradicts prior (e.g. "we switched from A to B", "that finding was wrong"), **annotate the old item** (e.g. add "—superseded by B", "—invalidated") rather than deleting; keeps change history. Append net-new items. Deduplicate. New sections (e.g. References, Errors & workarounds) may appear in incremental merge when content exists; add them if absent. Update Summary to reflect the full conversation.

## Incremental Index

File: `~/.cursor/persistent-memory/incremental-index.json`

```json
{
  "version": 1,
  "conversations": {
    "{conversation_id}": {
      "lastProcessedLineCount": 150,
      "lastProcessedAt": "2026-03-11T12:50:00.000Z"
    }
  }
}
```

- Load existing index if present.
- After successfully writing the summary, set or update `conversations["{conversation_id}"].lastProcessedLineCount` to the number of transcript lines processed (0-based last line index + 1), and `lastProcessedAt` to current ISO timestamp (e.g. `new Date().toISOString()`).
- Preserve other conversation entries; only update the current one.
- When looking up `lastProcessedLineCount` (e.g. manual invocation): list `~/.cursor/persistent-memory/incremental-index-*.json` (exclude `incremental-index.json`), read each; if not in main, search archives; use the entry with latest `lastProcessedAt` if found in multiple.

## Session List Update

File: `~/.cursor/persistent-memory/sessions.md`

Each line: `{conversation_id[:8]} | {YYYY-MM-DDTHHMM} | {title} | {tags}`

- **Timestamp**: When the followup_message provides an explicit timestamp (e.g. "Use this exact timestamp `2026-03-11T1446`"), use that value. Do not generate your own timestamp.
- Upsert: If a line starting with `{conversation_id[:8]}` exists, replace it. Otherwise prepend (newest at top).

## Transcript Parsing

- JSONL format: each line is `{"role":"user"|"assistant","message":{"content":[...]}}`
- Extract text from `content` array (type "text" → "text" field)
- When in incremental mode, read only lines from the specified start index to end
- Focus on user requests, assistant decisions, and code/edit outcomes
- **Handoff**: Prioritize extracting: workspace/project name (from transcript path or user context), key paths, references (Notion, design docs, issues), git state (branch, remote), errors/workarounds, and explicit "next step" or "when continuing" cues
- **Never truncate** the output—process all specified lines and merge fully.

## When to Skip

If the transcript is empty, unreadable, or contains no substantive content (and no existing summary to keep), respond:

```
No session summary generated.
```

Do not create empty files.
