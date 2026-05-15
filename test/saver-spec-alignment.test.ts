import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("agents/persistent-memory-saver.md", () => {
  const md = readFileSync(join(root, "agents/persistent-memory-saver.md"), "utf8");

  test("does not reintroduce the stricter canned-response clause removed from existing-summaries", () => {
    expect(md).not.toContain("no index work was required");
  });

  test("does not use vague 'repaired' wording for catalog reconciliation outcomes", () => {
    expect(md).not.toMatch(/reconcil[^\n]*repaired|repaired[^\n]*reconcil/i);
  });

  test("defines a single canned no-work predicate tied to summaries/ and sessions.md", () => {
    expect(md).toContain("**Canned “no work” response:**");
    expect(md).toContain("did **not** write or update any file under **`~/.cursor/persistent-memory/summaries/`**");
    expect(md).toContain("catalog reconciliation made **no** change to **`sessions.md`**");
  });

  test("documents forward-only catalog completeness instead of row-count equality", () => {
    expect(md).toContain("**Catalog completeness (forward-only):**");
    expect(md).not.toContain("**Retrieve contract:**");
  });

  test("uses deterministic subagent-summary skip rules under Catalog reconciliation", () => {
    expect(md).toContain("**Subagent / worker summaries (do not catalog):**");
    expect(md).toContain("Under **`## Transcript`**");
    expect(md).toContain("Under **`## Workspace`**");
  });
});

describe("hooks/persistent-memory-stop.ts", () => {
  const ts = readFileSync(join(root, "hooks/persistent-memory-stop.ts"), "utf8");

  test("follow-up body matches saver canned-response predicate", () => {
    expect(ts).toContain("wrote no new or updated files under");
    expect(ts).toContain("catalog reconciliation left");
    expect(ts).toContain("**Canned “no work” response**");
  });
});
