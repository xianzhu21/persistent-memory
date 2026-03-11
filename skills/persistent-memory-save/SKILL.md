---
name: persistent-memory-save
description: When triggered by Stop hook, read the current session transcript (JSONL), generate a structured summary, write to ~/.cursor/persistent-memory/{conversation_id}.md and update index.md.
---

# Persistent Memory Save

Generate a structured summary from the current transcript and persist it for `persistent-memory-retrieve`. Output in English only.

## Inputs (from followup_message)

- `transcript_path`: Path to the current session's agent-transcript JSONL file
- `conversation_id`: UUID for this session (use as filename)

## Output Format

Write the summary to `~/.cursor/persistent-memory/{conversation_id}.md`:

```markdown
## {YYYY-MM-DDTHH:MM} | {Short title}

### Summary
1–3 sentence summary of what was discussed and accomplished.

### Decisions
- Bullet list of decisions made (architecture, approach, tool choice, etc.)

### Key findings
- Bullet list of discoveries, root causes, insights

### Files changed
- List of files modified or created

### Open
- Unresolved questions, TODOs, follow-ups

### Tags
#tag1 #tag2 #tag3
```

- **Omit section headers that have no content.** Do not write empty sections (e.g. skip `### Open` if there are no open items, skip `### Files changed` if nothing was modified).
- Use lowercase tags with hyphens (e.g. `#surfaceflinger`, `#parallel-refresh`, `#cursor`). Infer from conversation content.

## Index Update

File: `~/.cursor/persistent-memory/index.md`

Each line: `{conversation_id[:8]} | {YYYY-MM-DDTHHMM} | {title} | {tags}`

- Upsert: If a line starting with `{conversation_id[:8]}` exists, replace it. Otherwise prepend (newest at top).
- Newest entries at the top (prepend on insert, or sort by timestamp desc when displaying).

## Transcript Parsing

- JSONL format: each line is `{"role":"user"|"assistant","message":{"content":[...]}}`
- Extract text from `content` array (type "text" → "text" field)
- Truncate if transcript is very long: keep first N and last M turns, or sample key turns
- Focus on user requests, assistant decisions, and code/edit outcomes

## When to Skip

If the transcript is empty, unreadable, or contains no substantive content, respond:

```
No session summary generated.
```

Do not create empty files.
