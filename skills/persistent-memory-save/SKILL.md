---
name: persistent-memory-save
description: Orchestrate persistent memory saves by delegating transcript processing and summary writes to `persistent-memory-session-updater`.
disable-model-invocation: true
---

# Persistent Memory Save

Incrementally update session summaries by delegating the full save flow to one subagent.

## Trigger

Use when the Stop hook follow-up asks to save persistent memory, the user runs `/persistent-memory-save`, or they ask to process transcripts into summaries.

## Workflow

1. Call `persistent-memory-session-updater`.
2. Return the updater result.

## Guardrails

- Keep the parent skill orchestration-only.
- Do not process transcripts or write summary files in the parent flow.
- Do not bypass the subagent.
