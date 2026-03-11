/// <reference types="bun-types-no-globals/lib/index.d.ts" />

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdin } from "bun";

const STATE_PATH = resolve(".cursor/hooks/state/persistent-memory.json");
const PERSISTENT_MEMORY_DIR = join(homedir(), ".cursor", "persistent-memory");
const INCREMENTAL_INDEX_PATH = join(PERSISTENT_MEMORY_DIR, "incremental-index.json");
const ARCHIVE_COUNT_THRESHOLD = 500; // archive when conversations >= this
const DEFAULT_MIN_TURNS = 10;
const DEFAULT_MIN_MINUTES = 120;
const TRIAL_DEFAULT_MIN_TURNS = 3;
const TRIAL_DEFAULT_MIN_MINUTES = 15;
const TRIAL_DEFAULT_DURATION_MINUTES = 24 * 60;

interface ConvEntry {
  lastProcessedLineCount: number;
  lastProcessedAt?: string; // ISO timestamp when last processed
}

function entryTimeMs(e: ConvEntry): number {
  if (!e.lastProcessedAt) return 0;
  const ms = new Date(e.lastProcessedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

interface IncrementalIndex {
  version: 1;
  conversations: Record<string, ConvEntry>;
}

function parseArchiveThreshold(): number {
  const v = process.env.PERSISTENT_MEMORY_ARCHIVE_COUNT;
  if (!v) return ARCHIVE_COUNT_THRESHOLD;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : ARCHIVE_COUNT_THRESHOLD;
}

function loadArchiveFiles(): Array<{ path: string; data: IncrementalIndex }> {
  if (!existsSync(PERSISTENT_MEMORY_DIR)) return [];
  const re = /^incremental-index-\d{4}-\d{2}-\d{2}T\d{6}\.json$/;
  const files: Array<{ path: string; data: IncrementalIndex }> = [];
  for (const name of readdirSync(PERSISTENT_MEMORY_DIR)) {
    if (!re.test(name)) continue;
    const path = join(PERSISTENT_MEMORY_DIR, name);
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as Partial<IncrementalIndex>;
      if (parsed.version === 1 && parsed.conversations) {
        files.push({ path, data: { version: 1, conversations: parsed.conversations } });
      }
    } catch {
      /* skip */
    }
  }
  return files;
}

function getLastProcessedFromIndexes(
  conversationId: string,
  main: IncrementalIndex,
  archives: Array<{ data: IncrementalIndex }>
): number {
  const mainEnt = main.conversations[conversationId];
  let best = mainEnt?.lastProcessedLineCount;
  let bestMs = mainEnt ? entryTimeMs(mainEnt) : 0;
  for (const { data } of archives) {
    const ent = data.conversations[conversationId];
    if (!ent) continue;
    const ms = entryTimeMs(ent);
    if (ms > bestMs) {
      bestMs = ms;
      best = ent.lastProcessedLineCount;
    }
  }
  return best ?? 0;
}

function maybeArchive(idx: IncrementalIndex): IncrementalIndex {
  const count = Object.keys(idx.conversations).length;
  const threshold = parseArchiveThreshold();

  if (count < threshold) return idx;

  type Ent = { id: string; lastProcessedLineCount: number; lastProcessedAt: string };
  const nowIso = new Date().toISOString();
  const entries: Ent[] = Object.entries(idx.conversations).map(([id, e]) => ({
    id,
    lastProcessedLineCount: e.lastProcessedLineCount,
    lastProcessedAt: e.lastProcessedAt ?? nowIso,
  }));

  entries.sort(
    (a, b) =>
      new Date(a.lastProcessedAt).getTime() - new Date(b.lastProcessedAt).getTime()
  );
  const toArchive = entries.slice(0, Math.floor(entries.length * 0.8));
  if (toArchive.length === 0) return idx;

  const d = new Date();
  const ts =
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` +
    `T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  const archivePath = join(PERSISTENT_MEMORY_DIR, `incremental-index-${ts}.json`);
  const archived: Record<string, ConvEntry> = {};
  for (const e of toArchive) {
    archived[e.id] = {
      lastProcessedLineCount: e.lastProcessedLineCount,
      lastProcessedAt: e.lastProcessedAt,
    };
  }

  if (!existsSync(PERSISTENT_MEMORY_DIR)) {
    mkdirSync(PERSISTENT_MEMORY_DIR, { recursive: true });
  }
  writeFileSync(
    archivePath,
    `${JSON.stringify({ version: 1, conversations: archived }, null, 2)}\n`,
    "utf-8"
  );

  const remaining: Record<string, ConvEntry> = {};
  const ids = new Set(toArchive.map((e) => e.id));
  for (const [id, e] of Object.entries(idx.conversations)) {
    if (!ids.has(id)) remaining[id] = e;
  }
  return { version: 1, conversations: remaining };
}

function loadAndMaybeArchive(): IncrementalIndex {
  if (!existsSync(INCREMENTAL_INDEX_PATH)) {
    return { version: 1, conversations: {} };
  }
  try {
    const raw = readFileSync(INCREMENTAL_INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<IncrementalIndex>;
    if (parsed.version !== 1 || !parsed.conversations) {
      return { version: 1, conversations: {} };
    }
    const idx: IncrementalIndex = { version: 1, conversations: parsed.conversations };
    const after = maybeArchive(idx);
    if (Object.keys(after.conversations).length < Object.keys(idx.conversations).length) {
      if (!existsSync(PERSISTENT_MEMORY_DIR)) {
        mkdirSync(PERSISTENT_MEMORY_DIR, { recursive: true });
      }
      writeFileSync(
        INCREMENTAL_INDEX_PATH,
        `${JSON.stringify({ version: 1, conversations: after.conversations }, null, 2)}\n`,
        "utf-8"
      );
    }
    return after;
  } catch {
    return { version: 1, conversations: {} };
  }
}

function getTranscriptLineCount(path: string | null | undefined): number {
  if (!path || !existsSync(path)) {
    return 0;
  }
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.length;
  } catch {
    return 0;
  }
}

function formatSessionsTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` +
    `T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`
  );
}

function toHeaderFormat(compact: string): string {
  if (compact.length >= 13) {
    return `${compact.slice(0, 11)}${compact.slice(11, 13)}:${compact.slice(13)}`;
  }
  return compact;
}

function getFollowupMessage(
  conversationId: string,
  transcriptPath: string | null | undefined,
  startLine: number,
  totalLines: number
): string {
  const tpath = transcriptPath ?? "";
  const timestamp = formatSessionsTimestamp(new Date());
  const timestampHeader = toHeaderFormat(timestamp);
  return (
    `Run the \`persistent-memory-save\` skill now. ` +
    `Process the current transcript at ${JSON.stringify(tpath)}, conversation_id ${JSON.stringify(conversationId)}. ` +
    `**Incremental mode**: Existing summary at \`~/.cursor/persistent-memory/${conversationId}.md\`. ` +
    `Only process transcript lines from line index ${startLine} to ${totalLines - 1} (0-based, ${totalLines - startLine} new lines). ` +
    `Read existing summary if present, extract from the new lines, merge (append and dedupe); do not truncate or drop prior content. ` +
    `Write merged summary to \`~/.cursor/persistent-memory/{conversation_id}.md\`. ` +
    `Update \`~/.cursor/persistent-memory/sessions.md\` with line: \`${conversationId.slice(0, 8)} | ${timestamp} | {title} | {tags}\`. Use this exact timestamp \`${timestamp}\` (do not generate your own). For the summary file header \`# {timestamp} | {title}\`, use \`${timestampHeader}\`. ` +
    `Update \`~/.cursor/persistent-memory/incremental-index.json\`: set \`conversations["${conversationId}"].lastProcessedLineCount\` = ${totalLines} and \`lastProcessedAt\` = \`${new Date().toISOString()}\`. ` +
    `Use grep to find existing index line by ID prefix and replace; prepend if not found. ` +
    `If transcript is empty or unreadable, respond: No session summary generated.`
  );
}

interface StopHookInput {
  conversation_id: string;
  generation_id?: string;
  status: "completed" | "aborted" | "error" | string;
  loop_count: number;
  transcript_path?: string | null;
}

interface PersistentMemoryState {
  version: 1;
  lastRunAtMs: number;
  turnsSinceLastRun: number;
  lastTranscriptMtimeMs: number | null;
  lastProcessedGenerationId: string | null;
  trialStartedAtMs: number | null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function loadState(): PersistentMemoryState {
  const fallback: PersistentMemoryState = {
    version: 1,
    lastRunAtMs: 0,
    turnsSinceLastRun: 0,
    lastTranscriptMtimeMs: null,
    lastProcessedGenerationId: null,
    trialStartedAtMs: null,
  };

  if (!existsSync(STATE_PATH)) {
    return fallback;
  }

  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistentMemoryState>;
    if (parsed.version !== 1) {
      return fallback;
    }
    return {
      version: 1,
      lastRunAtMs:
        typeof parsed.lastRunAtMs === "number" && Number.isFinite(parsed.lastRunAtMs)
          ? parsed.lastRunAtMs
          : 0,
      turnsSinceLastRun:
        typeof parsed.turnsSinceLastRun === "number" &&
        Number.isFinite(parsed.turnsSinceLastRun) &&
        parsed.turnsSinceLastRun >= 0
          ? parsed.turnsSinceLastRun
          : 0,
      lastTranscriptMtimeMs:
        typeof parsed.lastTranscriptMtimeMs === "number" &&
        Number.isFinite(parsed.lastTranscriptMtimeMs)
          ? parsed.lastTranscriptMtimeMs
          : null,
      lastProcessedGenerationId:
        typeof parsed.lastProcessedGenerationId === "string"
          ? parsed.lastProcessedGenerationId
          : null,
      trialStartedAtMs:
        typeof parsed.trialStartedAtMs === "number" &&
        Number.isFinite(parsed.trialStartedAtMs)
          ? parsed.trialStartedAtMs
          : null,
    };
  } catch {
    return fallback;
  }
}

function saveState(state: PersistentMemoryState): void {
  const directory = dirname(STATE_PATH);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function getTranscriptMtimeMs(
  transcriptPath: string | null | undefined
): number | null {
  if (!transcriptPath) {
    return null;
  }
  try {
    return statSync(transcriptPath).mtimeMs;
  } catch {
    return null;
  }
}

function shouldCountTurn(input: StopHookInput): boolean {
  return input.status === "completed" && input.loop_count === 0;
}

async function parseHookInput<T>(): Promise<T> {
  const text = await stdin.text();
  return JSON.parse(text || "{}") as T;
}

async function main(): Promise<number> {
  try {
    const input = await parseHookInput<StopHookInput>();
    const state = loadState();

    const trialFromArg = process.argv.includes("--trial");
    const trialEnabled =
      trialFromArg ||
      parseBoolean(process.env.PERSISTENT_MEMORY_TRIAL_MODE);

    if (input.generation_id && input.generation_id === state.lastProcessedGenerationId) {
      console.log(JSON.stringify({}));
      return 0;
    }
    state.lastProcessedGenerationId = input.generation_id ?? null;

    const countedTurn = shouldCountTurn(input);
    const turnIncrement = countedTurn ? 1 : 0;
    const turnsSinceLastRun = state.turnsSinceLastRun + turnIncrement;
    const now = Date.now();

    if (trialEnabled && countedTurn && state.trialStartedAtMs === null) {
      state.trialStartedAtMs = now;
    }

    const trialDurationMinutes = parsePositiveInt(
      process.env.PERSISTENT_MEMORY_TRIAL_DURATION_MINUTES,
      TRIAL_DEFAULT_DURATION_MINUTES
    );
    const trialMinTurns = parsePositiveInt(
      process.env.PERSISTENT_MEMORY_TRIAL_MIN_TURNS,
      TRIAL_DEFAULT_MIN_TURNS
    );
    const trialMinMinutes = parsePositiveInt(
      process.env.PERSISTENT_MEMORY_TRIAL_MIN_MINUTES,
      TRIAL_DEFAULT_MIN_MINUTES
    );
    const inTrialWindow =
      trialEnabled &&
      state.trialStartedAtMs !== null &&
      now - state.trialStartedAtMs < trialDurationMinutes * 60_000;

    const minTurns = parsePositiveInt(
      process.env.PERSISTENT_MEMORY_MIN_TURNS,
      DEFAULT_MIN_TURNS
    );
    const minMinutes = parsePositiveInt(
      process.env.PERSISTENT_MEMORY_MIN_MINUTES,
      DEFAULT_MIN_MINUTES
    );

    const effectiveMinTurns = inTrialWindow ? trialMinTurns : minTurns;
    const effectiveMinMinutes = inTrialWindow ? trialMinMinutes : minMinutes;
    const minutesSinceLastRun =
      state.lastRunAtMs > 0
        ? Math.floor((now - state.lastRunAtMs) / 60000)
        : Number.POSITIVE_INFINITY;
    const transcriptMtimeMs = getTranscriptMtimeMs(input.transcript_path);
    const hasTranscriptAdvanced =
      transcriptMtimeMs !== null &&
      (state.lastTranscriptMtimeMs === null ||
        transcriptMtimeMs > state.lastTranscriptMtimeMs);

    const shouldTrigger =
      countedTurn &&
      turnsSinceLastRun >= effectiveMinTurns &&
      minutesSinceLastRun >= effectiveMinMinutes &&
      hasTranscriptAdvanced;

    if (shouldTrigger) {
      state.lastRunAtMs = now;
      state.turnsSinceLastRun = 0;
      state.lastTranscriptMtimeMs = transcriptMtimeMs;
      saveState(state);

      const totalLines = getTranscriptLineCount(input.transcript_path);
      const incrementalIndex = loadAndMaybeArchive();
      const archives = loadArchiveFiles();
      const lastProcessed = getLastProcessedFromIndexes(
        input.conversation_id ?? "",
        incrementalIndex,
        archives
      );
      const startLine = Math.min(lastProcessed, totalLines);

      console.log(
        JSON.stringify({
          followup_message: getFollowupMessage(
            input.conversation_id ?? "",
            input.transcript_path,
            startLine,
            totalLines
          ),
        })
      );
      return 0;
    }

    state.turnsSinceLastRun = turnsSinceLastRun;
    saveState(state);
    console.log(JSON.stringify({}));
    return 0;
  } catch (error) {
    console.error("[persistent-memory-stop] failed", error);
    console.log(JSON.stringify({}));
    return 0;
  }
}

const exitCode = await main();
process.exit(exitCode);
