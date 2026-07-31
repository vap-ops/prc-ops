// Subagent-audit hygiene batch (operator "go both", 2026-07-31) — the merged
// Bash PreToolUse guard hook, driven for real: each case spawns the hook
// exactly as the harness does (node <hook>, event JSON on stdin) and asserts
// exit code + guidance. Doubles as the unit's real-flow evidence (CLAUDE.md
// gate 4: "run the hook against crafted stdin").
//
// ONE script, two checks (single Node cold-start per Bash call — the two-spawn
// shape measured 841 ms/call on this box):
// ① cd-prefix — the cwd-drift wall: a repo-tool command must START with an
//   absolute `cd` (drift bit 6× on 2026-07-31 alone; worst case a verification
//   that measures nothing and reads as success).
// ② schema-writes — the Write|Edit-matcher bypass wall: write-shaped shell
//   commands into supabase/migrations|tests dodge the audit-log/lane-claim
//   hooks, which only see file tools. Heuristic belt, not a vault.
// Overrides: launch-env vars, or an in-command marker (#ALLOW_NO_CD /
// #ALLOW_BASH_SCHEMA_WRITE) — the env form is unreachable from inside a
// session (shell env does not reach the hook process), review finding.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const HOOK = path.join(process.cwd(), ".claude", "hooks", "bash-guards.js");

function runHook(
  command: unknown,
  env: Record<string, string> = {},
): { status: number | null; stderr: string } {
  const input =
    command === "__GARBAGE__"
      ? "not json at all {"
      : JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const res = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_ALLOW_NO_CD: "", CLAUDE_ALLOW_BASH_SCHEMA_WRITE: "", ...env },
  });
  return { status: res.status, stderr: res.stderr ?? "" };
}

describe("bash-guards: cd-prefix check (cwd-drift wall)", () => {
  it("blocks a bare repo-tool command with the cd guidance", () => {
    const r = runHook("pnpm test");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cd /d/");
  });

  it("blocks the export-first shape that actually bit (PATH prefix, no cd)", () => {
    expect(runHook('export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:test').status).toBe(2);
  });

  it("blocks the relative-cd shape that actually bit (cd prc-ops)", () => {
    expect(runHook("cd prc-ops && pnpm test").status).toBe(2);
  });

  it("blocks semicolon, newline, and env-prefix chains (review holes)", () => {
    expect(runHook("git fetch -q; pnpm exec supabase db query --linked").status).toBe(2);
    expect(runHook("git fetch -q\npnpm test").status).toBe(2);
    expect(runHook("NODE_ENV=test pnpm exec vitest run").status).toBe(2);
  });

  it("blocks unanchored script invocations in every house shape", () => {
    expect(runHook('bash scripts/ship-pr.sh "t" "b"').status).toBe(2);
    expect(runHook("./scripts/ship-pr.sh a b").status).toBe(2);
    expect(runHook("tsx scripts/run-pgtap.ts").status).toBe(2);
  });

  it("allows anchored commands: git-bash, Windows, quoted, parenthesised", () => {
    expect(
      runHook('cd /d/claude/projects/prc-ops/prc-ops-musterundo && export PATH="x" && pnpm test')
        .status,
    ).toBe(0);
    expect(runHook("cd D:\\claude\\projects\\x && pnpm test").status).toBe(0);
    expect(runHook('cd "/d/claude/projects/prc-ops/x" && pnpm test').status).toBe(0);
    expect(runHook("(cd /d/x && pnpm test)").status).toBe(0);
  });

  it("does not fire on repo-tool words inside quoted prose (gh bodies)", () => {
    expect(
      runHook("gh pr comment 1 --body 'ran pnpm lint && pnpm typecheck && pnpm test'").status,
    ).toBe(0);
  });

  it("ignores commands that touch no repo tool", () => {
    expect(runHook("gh pr list --repo vap-ops/prc-ops").status).toBe(0);
    expect(runHook("ls /c/Users/someone/.claude").status).toBe(0);
    expect(runHook("git status --porcelain").status).toBe(0);
  });

  it("honours the launch-env override and the in-command marker", () => {
    expect(runHook("pnpm test", { CLAUDE_ALLOW_NO_CD: "1" }).status).toBe(0);
    expect(runHook("pnpm --version #ALLOW_NO_CD cwd-independent").status).toBe(0);
  });

  it("fails open on garbage stdin and on a non-string command", () => {
    expect(runHook("__GARBAGE__").status).toBe(0);
    expect(runHook(42).status).toBe(0);
  });
});

describe("bash-guards: schema-writes check (Write|Edit-matcher bypass wall)", () => {
  it("blocks sed -i into a migration file", () => {
    const r = runHook("cd /d/x && sed -i 's/a/b/' supabase/migrations/20260101000000_x.sql");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Write/Edit");
  });

  it("blocks a redirect whose TARGET is a protected path", () => {
    expect(
      runHook("cd /d/x && echo 'select 1;' > supabase/tests/database/99-x.test.sql").status,
    ).toBe(2);
  });

  it("blocks rm of a file AND of the bare directory (review hole)", () => {
    expect(runHook("cd /d/x && rm supabase/migrations/20260101000000_x.sql").status).toBe(2);
    expect(runHook("cd /d/x && rm -rf supabase/migrations").status).toBe(2);
  });

  it("blocks git checkout/restore over protected paths (silent work-destroyer)", () => {
    expect(runHook("cd /d/x && git checkout -- supabase/migrations/x.sql").status).toBe(2);
    expect(runHook("cd /d/x && git restore supabase/tests/database/25-x.test.sql").status).toBe(2);
  });

  it("allows read-shaped commands over the same paths", () => {
    expect(runHook("cd /d/x && pnpm db:push").status).toBe(0);
    expect(runHook("cd /d/x && grep -n foo supabase/migrations/a.sql").status).toBe(0);
    expect(
      runHook("cd /d/x && pnpm exec supabase db query --linked --file supabase/migrations/a.sql")
        .status,
    ).toBe(0);
  });

  it("allows logging redirects that only MENTION protected paths (review hole)", () => {
    expect(
      runHook(
        "cd /d/x && pnpm exec tsx scripts/run-pgtap.ts supabase/tests/database/221-catalog.test.sql > /tmp/pgtap.log 2>&1",
      ).status,
    ).toBe(0);
    expect(
      runHook("cd /d/x && git diff origin/main -- supabase/migrations/ > /tmp/d.txt").status,
    ).toBe(0);
  });

  it("ignores writes anywhere else", () => {
    expect(runHook("echo hi > /tmp/scratch.log").status).toBe(0);
  });

  it("honours the launch-env override and the in-command marker", () => {
    expect(
      runHook("sed -i 's/a/b/' supabase/migrations/x.sql", {
        CLAUDE_ALLOW_BASH_SCHEMA_WRITE: "1",
      }).status,
    ).toBe(0);
    expect(
      runHook("cp supabase/migrations/x.sql /tmp/backup.sql #ALLOW_BASH_SCHEMA_WRITE copy-out")
        .status,
    ).toBe(0);
  });
});
