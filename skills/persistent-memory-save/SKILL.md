---
name: persistent-memory-save
description: When triggered by Stop hook or /persistent-memory-save, delegate user-session summaries and index updates to `persistent-memory-saver` (goal: durable recall of real work, not subagent logs).
disable-model-invocation: true
---

# Persistent Memory Save

**Why:** Persist what **you** (the user) did in repo-facing chats—decisions, files, tickets—so `/persistent-memory-retrieve` and future chats can **reload context** without mining raw JSONL. **Subagent** `…/subagents/*.jsonl` = worker logs only (saver: index-only).

**How:** Delegate the full save to one `persistent-memory-saver` subagent; follow `agents/persistent-memory-saver.md` (goal, merge rules, **Merge and full re-synthesis (MUST)**).

## Trigger

Use when the Stop hook follow-up fires, the user runs `/persistent-memory-save`, or session summaries need incremental updates from transcripts.

## Workflow

1. **Use the Task tool once (MUST).** `subagent_type`: `persistent-memory-saver`. Task `prompt`: follow `agents/persistent-memory-saver.md` (including **Merge and full re-synthesis (MUST)**: one `#` H1 per summary file, no stacked duplicate templates); **do not** mine transcripts here. If **`PERSISTENT_MEMORY_TRIGGER=stop-hook`** appears in the instruction, first line **`PERSISTENT_MEMORY_SCOPE=current-session`**, and copy **`transcript_path=`** / **`conversation_id=`** from the follow-up if present, else saver step-3 mtime fallback. For manual **`/persistent-memory-save`** (no hook token), first line **`PERSISTENT_MEMORY_SCOPE=existing-summaries`** so the saver only considers **parent** `*.jsonl` under this workspace’s transcript roots (step 1) for `conversation_id`s in **`<workspace-root>/.cursor/hooks/state/persistent-memory.json`** whose entry has **`lastTranscriptMtimeMs` not null** (the Stop hook sets this when cadence fires a save follow-up—cheap vs listing all `summaries/*.md`). It **does not** walk the full `agent-transcripts/` tree and **skips** chats the hook never promoted. **First-time** summaries are only created via the Stop hook **`current-session`** flow (not manual slash-save). The saver **must not** create user-facing summaries for **`.../agent-transcripts/.../subagents/*.jsonl`** (index-only; see doc)—those are subagent **task logs**, not the user’s main session. Always: incremental index `~/.cursor/persistent-memory/incremental-index.json`, re-synthesized `summaries/`, gzip `transcripts/`, `sessions.md` **`End` descending**, **`#project-<slug>`** tags; no ad-hoc helper scripts.

2. Return the subagent result (verbatim summary of outcome is fine).

## Guardrails

- Keep the parent skill orchestration-only.
- Do not mine transcripts or edit files in the parent flow.
- Do not bypass the subagent.

## VS Code workspace projects (`.code-workspace`)

Subagent must follow `agents/persistent-memory-saver.md` step 1: union **all** `agent-transcripts` dirs for the repo token (folder-open **and** `*code-workspace` siblings).
