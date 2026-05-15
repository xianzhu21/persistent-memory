---
name: persistent-memory-save
description: When triggered by Stop hook or /persistent-memory-save (optional absolute parent transcript path for explicit-transcript), delegate user-session summaries and index updates to `persistent-memory-saver` (goal: durable recall of real work, not subagent logs).
disable-model-invocation: true
---

# Persistent Memory Save

**Why:** Persist what **you** (the user) did in repo-facing chats—decisions, files, tickets—so `/persistent-memory-retrieve` and future chats can **reload context** without mining raw JSONL. **Subagent** `…/subagents/*.jsonl` = worker logs only (saver: index-only).

**How:** Delegate the full save to one `persistent-memory-saver` subagent; follow `agents/persistent-memory-saver.md` (goal, merge rules, **Merge and full re-synthesis (MUST)**).

## Trigger

Use when the Stop hook follow-up fires, the user runs `/persistent-memory-save`, or session summaries need incremental updates from transcripts.

## Workflow

1. **Use the Task tool once (MUST).** `subagent_type`: `persistent-memory-saver`. Task `prompt`: follow `agents/persistent-memory-saver.md` (including **Merge and full re-synthesis (MUST)**: one `#` H1 per summary file, no stacked duplicate templates); **do not** mine transcripts here. **First lines of the Task `prompt` (scope routing):**
   - **Explicit parent transcript path:** If the user’s message includes an absolute path to a **parent** Cursor transcript **`*.jsonl`** (optional leading **`@`**, optional Markdown link or backticks—normalize to a plain absolute path), and the path contains **`/agent-transcripts/`** and does **not** contain **`/subagents/`**, then use **`PERSISTENT_MEMORY_SCOPE=explicit-transcript`** and **`transcript_path=<that absolute path>`** (strip **`@`**, trim). **Precedence:** use this branch whenever it applies, even if **`PERSISTENT_MEMORY_TRIGGER=stop-hook`** also appears (the user-chosen file wins for this Task). **First-time** summaries for that chat are allowed without hook promotion. If the user pasted **multiple** qualifying paths, use the **first** one only and note the rest were ignored—or ask them to re-run for another path.
   - **Else Stop hook:** If **`PERSISTENT_MEMORY_TRIGGER=stop-hook`** appears in the instruction, **`PERSISTENT_MEMORY_SCOPE=current-session`**, and copy **`transcript_path=`** / **`conversation_id=`** from the follow-up if present, else saver step-3 mtime fallback.
   - **Else manual default:** **`PERSISTENT_MEMORY_SCOPE=existing-summaries`** — the saver only considers **parent** `*.jsonl` under this workspace’s transcript roots (step 1) for `conversation_id`s in **`<workspace-root>/.cursor/hooks/state/persistent-memory.json`** whose entry has **`lastTranscriptMtimeMs` not null** (the Stop hook sets this when cadence fires a save follow-up—cheap vs listing all `summaries/*.md`). It **does not** walk the full `agent-transcripts/` tree and **skips** chats the hook never promoted. **Default first-time** summaries for those ids remain the Stop hook **`current-session`** flow unless the user uses **`explicit-transcript`** above.
   The saver **must not** create user-facing summaries for **`.../agent-transcripts/.../subagents/*.jsonl`** in **`existing-summaries`** / **`current-session`** (index-only; see doc). In **`explicit-transcript`**, a **`subagents/`** path is an **error** (the user asked for a session save—point them at the parent **`{id}/{id}.jsonl`**). Always: incremental index `~/.cursor/persistent-memory/incremental-index.json`, re-synthesized `summaries/`, gzip `transcripts/`, `sessions.md` **`End` descending**, **`#project-<slug>`** tags, and **Catalog reconciliation (MUST)** in `agents/persistent-memory-saver.md` so every eligible on-disk **`summaries/*.md`** gets a **`sessions.md`** row when missing (forward-only; see doc); no ad-hoc helper scripts.

2. Return the subagent result (verbatim summary of outcome is fine).

## Guardrails

- **Low signal for other durable memory:** Treat **`/persistent-memory-save`** outcomes (subagent summary, index counts, gzip paths) as **low signal**—the parent must **not** mine them into **`AGENTS.md`**, Notion task logs, or similar “what we learned” write-ups **unless** the user explicitly asks to capture something from that run.
- Keep the parent skill orchestration-only.
- Do not mine transcripts or edit files in the parent flow.
- Do not bypass the subagent.
- **Anti-pattern (MUST NOT):** The parent must **not** “finish the job” by running **`gzip`**, editing **`~/.cursor/persistent-memory/summaries/*.md`**, **`sessions.md`**, or **`incremental-index.json`** itself—even if that reproduces the same artifacts. **Only** the **`persistent-memory-saver`** subagent may perform those writes. If the Task tool is unavailable, report that and stop; do not substitute an inline script.

## VS Code workspace projects (`.code-workspace`)

Subagent must follow `agents/persistent-memory-saver.md` step 1: union **all** `agent-transcripts` dirs for the repo token (folder-open **and** `*code-workspace` siblings).
