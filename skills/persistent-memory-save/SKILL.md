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

1. Call `persistent-memory-saver` (it merges summaries, archives transcripts, updates the incremental index, and rewrites `sessions.md` with **all data rows sorted by `End` descending**—newest transcript `End` first per `agents/persistent-memory-saver.md`. Tags in `sessions.md` and in each summary’s `## Tags` include **`#project-<slug>`** first, from the transcript path.)
2. Return the saver result.

## Guardrails

- Keep the parent skill orchestration-only.
- Do not mine transcripts or edit files in the parent flow.
- Do not bypass the subagent.

## VS Code workspace projects (`.code-workspace`)

The subagent must follow `agents/persistent-memory-saver.md` step 1: scan **all** matching `agent-transcripts` dirs for the same repo token. Example: `.../mnt-2tb-monalisadesign-gloable/agent-transcripts` (window opened on the folder) **and** `.../mnt-2tb-monalisadesign-gloable-monalisadesign-code-workspace/agent-transcripts` (window opened via `monalisadesign.code-workspace`). Chats from the workspace window live under the `*code-workspace` slug—scanning only the folder slug misses them. This is about **VS Code/Cursor project identity**, not whether the `.code-workspace` file is multi-root.
