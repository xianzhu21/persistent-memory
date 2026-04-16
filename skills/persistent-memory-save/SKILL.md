---
name: persistent-memory-save
description: When triggered by Stop hook or /persistent-memory-save, delegate incremental session summaries and index updates to `persistent-memory-saver`.
disable-model-invocation: true
---

# Persistent Memory Save

Keep session summaries current by delegating the full save flow to one subagent.

## Trigger

Use when the Stop hook follow-up fires, the user runs `/persistent-memory-save`, or session summaries need incremental updates from transcripts.

## Workflow

1. **Use the Task tool once (MUST).** Set `subagent_type` to `persistent-memory-saver`. In `prompt`, tell the saver to follow `agents/persistent-memory-saver.md` for **this** Cursor workspace: discover every matching `~/.cursor/projects/*/agent-transcripts/` root (folder vs `*code-workspace` slugs), use `~/.cursor/persistent-memory/incremental-index.json` for mtime-based incremental processing, merge into `summaries/{conversation_id}.md`, gzip raw JSONL to `transcripts/{conversation_id}.jsonl.gz`, rewrite `sessions.md` with **all data rows sorted by `End` descending** (newest first), update the index. Tags in `sessions.md` and each summary’s `## Tags` must lead with **`#project-<slug>`** from the transcript path. **Do not** mine transcripts or write those files in this chat—the subagent owns all disk writes.
   To reduce runtime and churn, instruct the subagent to **avoid generating temporary helper scripts** (e.g. ad-hoc Python files) and to perform the required work via direct file operations and minimal shell commands only.
2. Return the subagent result (verbatim summary of outcome is fine).

## Guardrails

- Keep the parent skill orchestration-only.
- Do not mine transcripts or edit files in the parent flow.
- Do not bypass the subagent.

## VS Code workspace projects (`.code-workspace`)

The subagent must follow `agents/persistent-memory-saver.md` step 1: scan **all** matching `agent-transcripts` dirs for the same repo token. Example: `.../mnt-2tb-monalisadesign-gloable/agent-transcripts` (window opened on the folder) **and** `.../mnt-2tb-monalisadesign-gloable-monalisadesign-code-workspace/agent-transcripts` (window opened via `monalisadesign.code-workspace`). Chats from the workspace window live under the `*code-workspace` slug—scanning only the folder slug misses them. This is about **VS Code/Cursor project identity**, not whether the `.code-workspace` file is multi-root.
