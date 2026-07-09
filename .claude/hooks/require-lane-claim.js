#!/usr/bin/env node
"use strict";

// PreToolUse hook — enforces the LANES.md single-writer discipline on migrations.
//
// Schema is single-lane (CLAUDE.md "Parallel sessions"): before touching
// supabase/migrations/ a session must claim its lane in ../LANES.md (the shared
// whiteboard outside the repo). This hook makes that claim mechanical: a Write/Edit
// to a migration file is blocked unless the current branch name appears in
// LANES.md. Schema work directly on `main` is always blocked — migrations belong
// in a worktree branch.
//
// Exit codes: 0 = allow, 2 = block. The hook fails open — any unexpected error
// exits 0 so a broken hook never blocks unrelated work.
// Override: CLAUDE_ALLOW_UNCLAIMED_MIGRATION=1.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Node hook script
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Node hook script
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Node hook script
const { execSync } = require("child_process");

const MIGRATION_PATH = /supabase\/migrations\//i;

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

function main() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return 0; // could not read stdin — fail open
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return 0; // unparseable input — fail open
  }

  const filePath = event && event.tool_input && event.tool_input.file_path;
  if (typeof filePath !== "string") {
    return 0; // no file path on this tool call — not our concern
  }

  const normalised = filePath.replace(/\\/g, "/");
  if (!MIGRATION_PATH.test(normalised)) {
    return 0; // not a migration file
  }

  if (process.env.CLAUDE_ALLOW_UNCLAIMED_MIGRATION) {
    return 0; // explicit override
  }

  // Resolve branch + repo root from the file's own directory (the session may run
  // from a wrapper cwd outside the repo). Unlike infra errors elsewhere in this
  // hook, a failed resolution here fails CLOSED: the path already matched the
  // protected migration class, and allowing it on "couldn't tell which branch"
  // (e.g. a relative path resolved against a non-repo cwd) is the exact bypass
  // this gate exists to stop. The env override remains the escape hatch.
  let branch, toplevel;
  try {
    const dir = path.dirname(path.resolve(filePath));
    branch = git("rev-parse --abbrev-ref HEAD", dir);
    toplevel = git("rev-parse --show-toplevel", dir);
  } catch {
    process.stderr.write(
      "Blocked: could not resolve the git branch for this migration path (is the path absolute and inside a checkout?).\n" +
        "Retry with an absolute path from a git worktree, or set CLAUDE_ALLOW_UNCLAIMED_MIGRATION=1 for an operator-approved exception.\n",
    );
    return 2;
  }

  if (branch === "main" || branch === "HEAD") {
    process.stderr.write(
      "Blocked: migration writes on `main` (or a detached HEAD) are forbidden — schema work runs in a worktree branch.\n" +
        "Create one: git worktree add ../prc-ops-<lane> -b <branch> origin/main  (CLAUDE.md — Parallel sessions).\n" +
        "Set CLAUDE_ALLOW_UNCLAIMED_MIGRATION=1 only for an operator-approved exception.\n",
    );
    return 2;
  }

  const lanesFile = path.join(toplevel, "..", "LANES.md");
  let lanes;
  try {
    lanes = fs.readFileSync(lanesFile, "utf8");
  } catch {
    return 0; // no whiteboard here (CI, fresh clone) — fail open
  }

  // Word-boundary match, not substring: a short/numeric branch name must not
  // ride on incidental prose or spec numbers elsewhere in the whiteboard.
  const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(lanes)) {
    return 0; // lane claimed
  }

  process.stderr.write(
    `Blocked: no lane claim found for branch '${branch}' in ${lanesFile}.\n` +
      "Schema is single-lane. Before touching supabase/migrations/: read the WHOLE LANES.md " +
      "(both prepend and append conventions), confirm no other schema lane is active, APPEND a claim " +
      `naming '${branch}' + the migration number you take, re-read to confirm it landed, then retry.\n` +
      "See CLAUDE.md — Parallel sessions, and memory safe-parallel-sessions.\n" +
      "Set CLAUDE_ALLOW_UNCLAIMED_MIGRATION=1 only for an operator-approved exception.\n",
  );
  return 2;
}

let code;
try {
  code = main();
} catch {
  code = 0; // any unexpected hook error — fail open
}
process.exit(code);
