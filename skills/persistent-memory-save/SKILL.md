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

1. Call `persistent-memory-saver` (it merges summaries, archives transcripts, updates the incremental index, and rewrites `sessions.md` with **all data rows sorted by `End` descending**—newest transcript `End` first per `agents/persistent-memory-saver.md`).
2. Return the saver result.

## Guardrails

- Keep the parent skill orchestration-only.
- Do not mine transcripts or edit files in the parent flow.
- Do not bypass the subagent.
