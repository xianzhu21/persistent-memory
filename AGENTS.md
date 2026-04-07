# AGENTS.md

## Cursor Cloud specific instructions

This is a **Cursor IDE plugin** (not a web app or traditional backend). The only executable code is `hooks/persistent-memory-stop.ts`, a TypeScript stop hook that runs under **Bun**.

### Prerequisites

- **Bun** (`~/.bun/bin/bun`) must be on `PATH`. The update script handles installation.

### Running / testing the hook

The stop hook reads `StopHookInput` JSON from stdin and writes JSON to stdout. Test it with:

```bash
echo '{"conversation_id":"c1","generation_id":"g1","status":"completed","loop_count":0,"transcript_path":"/tmp/test.jsonl"}' \
  | bun run hooks/persistent-memory-stop.ts
```

- Output `{}` means no followup triggered (thresholds not met or duplicate `generation_id`).
- Output with `followup_message` means the save skill should run.
- Hook state is written to `.cursor/hooks/state/persistent-memory.json` (relative to cwd).
- Trial mode: pass `--trial` flag or set `PERSISTENT_MEMORY_TRIAL_MODE=true`. See `README.md` for all env overrides.

### No build, lint, or package manager

There is no `package.json`, no linter config, no build step, and no automated test suite. Bun executes TypeScript directly. The skills (`skills/*/SKILL.md`) are AI-agent instructions, not runnable code.

### Gotcha: state file location

The hook resolves `.cursor/hooks/state/persistent-memory.json` relative to the working directory. When testing locally, run from the repo root (`/workspace`) so state writes go to the expected place.
