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

1. **Use the Task tool once (MUST).** `subagent_type`: `persistent-memory-saver`. Task `prompt`: follow `agents/persistent-memory-saver.md`; **do not** mine transcripts here. If **`PERSISTENT_MEMORY_TRIGGER=stop-hook`** appears in the instruction, first line **`PERSISTENT_MEMORY_SCOPE=current-session`**, and copy **`transcript_path=`** / **`conversation_id=`** from the follow-up if present, else saver step-3 mtime fallback. For manual **`/persistent-memory-save`** (no hook token), use **`PERSISTENT_MEMORY_SCOPE=all`**. Always: incremental index `~/.cursor/persistent-memory/incremental-index.json`, merge `summaries/`, gzip `transcripts/`, `sessions.md` **`End` descending**, **`#project-<slug>`** tags; no ad-hoc helper scripts.

2. Return the subagent result (verbatim summary of outcome is fine).

## Guardrails

- Keep the parent skill orchestration-only.
- Do not mine transcripts or edit files in the parent flow.
- Do not bypass the subagent.

## VS Code workspace projects (`.code-workspace`)

Subagent must follow `agents/persistent-memory-saver.md` step 1: union **all** `agent-transcripts` dirs for the repo token (folder-open **and** `*code-workspace` siblings).
