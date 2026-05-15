/// <reference types="bun-types-no-globals/lib/index.d.ts" />

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stdin } from "bun";

const STATE_PATH = resolve(".cursor/hooks/state/persistent-memory.json");
const DEFAULT_MIN_TURNS = 6;
const DEFAULT_MIN_MINUTES = 30;
const TRIAL_DEFAULT_MIN_TURNS = 3;
const TRIAL_DEFAULT_MIN_MINUTES = 15;
const TRIAL_DEFAULT_DURATION_MINUTES = 24 * 60;
const DEFAULT_CONVERSATIONS_PRUNE_AFTER_DAYS = 60;

const FOLLOWUP_BODY =
  `Run the \`persistent-memory-save\` skill now. Use the \`persistent-memory-saver\` subagent for the full session summary flow. Use incremental transcript processing with index file \`~/.cursor/persistent-memory/incremental-index.json\`: only consider transcripts not in the index or transcripts whose mtime is newer than indexed mtimeMs. Follow \`agents/persistent-memory-saver.md\` for transcript roots (including folder vs \`*code-workspace\` project slugs) and for **subagent** transcript paths: JSONL under \`.../agent-transcripts/.../subagents/\` get **index-only** updates (no \`summaries/*.md\`, no gzip, no \`sessions.md\` row)—user memory is the **parent** chat, not the worker log. Have the subagent merge and write \`~/.cursor/persistent-memory/summaries/{conversation_id}.md\` for user sessions, archive to \`~/.cursor/persistent-memory/transcripts/{conversation_id}.jsonl.gz\`, update \`sessions.md\` and the index as in the doc, and run **Catalog reconciliation (MUST)** so every eligible on-disk \`summaries/*.md\` gains a \`sessions.md\` row when missing (forward-only; see doc). Avoid generating temporary helper scripts (e.g. ad-hoc Python files); do the required work via direct file operations and minimal shell commands only. Use the exact \`No session summary generated (no substantive content); index updated.\` reply only when step 4 wrote no new or updated files under \`summaries/\` **and** catalog reconciliation left \`sessions.md\` unchanged—see agents doc **Canned “no work” response** (step 5).`;

const FOLLOWUP_MESSAGE = `PERSISTENT_MEMORY_TRIGGER=stop-hook\n${FOLLOWUP_BODY}`;

interface StopHookInput {
  conversation_id: string;
  generation_id?: string;
  status: "completed" | "aborted" | "error" | string;
  loop_count: number;
  transcript_path?: string | null;
}

interface ConversationCadence {
  lastRunAtMs: number;
  turnsSinceLastRun: number;
  lastTranscriptMtimeMs: number | null;
  lastProcessedGenerationId: string | null;
  trialStartedAtMs: number | null;
}

interface PersistentMemoryState {
  conversations: Record<string, ConversationCadence>;
}

function emptyConv(): ConversationCadence {
  return {
    lastRunAtMs: 0,
    turnsSinceLastRun: 0,
    lastTranscriptMtimeMs: null,
    lastProcessedGenerationId: null,
    trialStartedAtMs: null,
  };
}

function normalizeConv(e: Partial<ConversationCadence> | undefined): ConversationCadence {
  const d = emptyConv();
  if (!e) return d;
  if (typeof e.lastRunAtMs === "number" && Number.isFinite(e.lastRunAtMs)) d.lastRunAtMs = e.lastRunAtMs;
  if (typeof e.turnsSinceLastRun === "number" && Number.isFinite(e.turnsSinceLastRun) && e.turnsSinceLastRun >= 0) {
    d.turnsSinceLastRun = e.turnsSinceLastRun;
  }
  if (typeof e.lastTranscriptMtimeMs === "number" && Number.isFinite(e.lastTranscriptMtimeMs)) {
    d.lastTranscriptMtimeMs = e.lastTranscriptMtimeMs;
  }
  if (typeof e.lastProcessedGenerationId === "string") d.lastProcessedGenerationId = e.lastProcessedGenerationId;
  if (typeof e.trialStartedAtMs === "number" && Number.isFinite(e.trialStartedAtMs)) {
    d.trialStartedAtMs = e.trialStartedAtMs;
  }
  return d;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const n = value.trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes" || n === "on";
}

/** Milliseconds max age for pruning other conversations; `null` = pruning disabled (`0` in env). Default: 60 days when unset. */
function parsePruneMaxAgeMs(): number | null {
  const raw = process.env.PERSISTENT_MEMORY_CONVERSATIONS_PRUNE_AFTER_DAYS?.trim();
  if (!raw) return DEFAULT_CONVERSATIONS_PRUNE_AFTER_DAYS * 86_400_000;
  const days = Number.parseInt(raw, 10);
  if (Number.isFinite(days) && days === 0) return null;
  if (!Number.isFinite(days) || days < 0) return DEFAULT_CONVERSATIONS_PRUNE_AFTER_DAYS * 86_400_000;
  return days * 86_400_000;
}

/** Prune anchor: transcript `.jsonl` mtime (ms) stored when cadence last fired a follow-up; null = never triggered → do not prune. */
function conversationActivityAnchorMs(c: ConversationCadence): number {
  if (c.lastTranscriptMtimeMs !== null && Number.isFinite(c.lastTranscriptMtimeMs) && c.lastTranscriptMtimeMs > 0) {
    return c.lastTranscriptMtimeMs;
  }
  return 0;
}

function pruneStaleConversations(state: PersistentMemoryState, nowMs: number, activeKey: string): void {
  const maxAgeMs = parsePruneMaxAgeMs();
  if (maxAgeMs === null) return;
  for (const id of Object.keys(state.conversations)) {
    if (id === activeKey) continue;
    const c = state.conversations[id];
    if (!c) continue;
    const anchorMs = conversationActivityAnchorMs(c);
    if (anchorMs === 0) continue;
    if (nowMs - anchorMs > maxAgeMs) delete state.conversations[id];
  }
}

function saveState(state: PersistentMemoryState): void {
  const directory = dirname(STATE_PATH);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function loadState(): PersistentMemoryState {
  const empty: PersistentMemoryState = { conversations: {} };
  if (!existsSync(STATE_PATH)) return empty;
  try {
    const p = JSON.parse(readFileSync(STATE_PATH, "utf-8")) as Record<string, unknown>;
    const raw = p.conversations;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
    const conversations: Record<string, ConversationCadence> = {};
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (id && entry && typeof entry === "object") conversations[id] = normalizeConv(entry as Partial<ConversationCadence>);
    }
    return { conversations };
  } catch {
    return empty;
  }
}

function convKey(input: StopHookInput): string {
  const id = typeof input.conversation_id === "string" ? input.conversation_id.trim() : "";
  return id.length > 0 ? id : "unknown";
}

function getTranscriptMtimeMs(transcriptPath: string | null | undefined): number | null {
  if (!transcriptPath) return null;
  try {
    return statSync(transcriptPath).mtimeMs;
  } catch {
    return null;
  }
}

function shouldCountTurn(input: StopHookInput): boolean {
  return input.status === "completed" && input.loop_count === 0;
}

async function parseHookInput(): Promise<StopHookInput> {
  try {
    return JSON.parse((await stdin.text()) || "{}") as StopHookInput;
  } catch {
    return { conversation_id: "", status: "error", loop_count: 0 };
  }
}

async function main(): Promise<number> {
  try {
    const input = await parseHookInput();
    const state = loadState();
    const key = convKey(input);
    if (!state.conversations[key]) state.conversations[key] = emptyConv();
    const conv = state.conversations[key];

    const trialEnabled =
      process.argv.includes("--trial") || parseBoolean(process.env.PERSISTENT_MEMORY_TRIAL_MODE);

    if (input.generation_id && input.generation_id === conv.lastProcessedGenerationId) {
      console.log(JSON.stringify({}));
      return 0;
    }
    const now = Date.now();
    conv.lastProcessedGenerationId = input.generation_id ?? null;

    const countedTurn = shouldCountTurn(input);
    const turnsSinceLastRun = conv.turnsSinceLastRun + (countedTurn ? 1 : 0);

    if (trialEnabled && countedTurn && conv.trialStartedAtMs === null) conv.trialStartedAtMs = now;

    const trialDurationMinutes = parsePositiveInt(
      process.env.PERSISTENT_MEMORY_TRIAL_DURATION_MINUTES,
      TRIAL_DEFAULT_DURATION_MINUTES
    );
    const trialMinTurns = parsePositiveInt(process.env.PERSISTENT_MEMORY_TRIAL_MIN_TURNS, TRIAL_DEFAULT_MIN_TURNS);
    const trialMinMinutes = parsePositiveInt(
      process.env.PERSISTENT_MEMORY_TRIAL_MIN_MINUTES,
      TRIAL_DEFAULT_MIN_MINUTES
    );
    const inTrialWindow =
      trialEnabled &&
      conv.trialStartedAtMs !== null &&
      now - conv.trialStartedAtMs < trialDurationMinutes * 60_000;

    const minTurns = parsePositiveInt(process.env.PERSISTENT_MEMORY_MIN_TURNS, DEFAULT_MIN_TURNS);
    const minMinutes = parsePositiveInt(process.env.PERSISTENT_MEMORY_MIN_MINUTES, DEFAULT_MIN_MINUTES);
    const effectiveMinTurns = inTrialWindow ? trialMinTurns : minTurns;
    const effectiveMinMinutes = inTrialWindow ? trialMinMinutes : minMinutes;
    const minutesSinceLastRun =
      conv.lastRunAtMs > 0 ? Math.floor((now - conv.lastRunAtMs) / 60000) : Number.POSITIVE_INFINITY;
    const transcriptMtimeMs = getTranscriptMtimeMs(input.transcript_path);
    const hasTranscriptAdvanced =
      transcriptMtimeMs !== null &&
      (conv.lastTranscriptMtimeMs === null || transcriptMtimeMs > conv.lastTranscriptMtimeMs);

    const shouldTrigger =
      countedTurn &&
      turnsSinceLastRun >= effectiveMinTurns &&
      minutesSinceLastRun >= effectiveMinMinutes &&
      hasTranscriptAdvanced;

    if (shouldTrigger) {
      conv.lastRunAtMs = now;
      conv.turnsSinceLastRun = 0;
      conv.lastTranscriptMtimeMs = transcriptMtimeMs;
    } else {
      conv.turnsSinceLastRun = turnsSinceLastRun;
    }
    pruneStaleConversations(state, now, key);
    saveState(state);

    if (shouldTrigger) {
      const hints: string[] = [];
      if (input.transcript_path) hints.push(`transcript_path=${input.transcript_path}`);
      if (input.conversation_id) hints.push(`conversation_id=${input.conversation_id}`);
      const followupMessage =
        hints.length > 0 ? `${FOLLOWUP_MESSAGE}\n\n${hints.join(" ")}` : FOLLOWUP_MESSAGE;
      console.log(JSON.stringify({ followup_message: followupMessage }));
    } else {
      console.log(JSON.stringify({}));
    }
    return 0;
  } catch (error) {
    console.error("[persistent-memory-stop] failed", error);
    console.log(JSON.stringify({}));
    return 0;
  }
}

const exitCode = await main();
process.exit(exitCode);
