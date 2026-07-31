#!/usr/bin/env node
"use strict";

// PreToolUse hook (matcher: Bash) — TWO checks in ONE script (a Node cold
// start costs ~840 ms/call on this box; the split-hook shape paid it twice on
// every Bash call, `ls` included).
//
// ① cd-prefix — the cwd-drift wall. The shell's working directory RESETS/
//   DRIFTS between Bash calls here (doctrine "Machine quirks"; it bit six
//   times on 2026-07-31 alone). A repo-tool command (pnpm/npx/vitest/
//   supabase/tsx, or scripts/ invocations) that does not START with an
//   absolute `cd` may silently run in the parent directory — pnpm dies on a
//   missing manifest at best; at worst a verification command measures
//   nothing and reports success. Deliberately OUT of scope: bare `git`/`gh`
//   (they run everywhere; walling `git status` would fight the resume
//   protocol far more than it protects it) and command substitution inside a
//   non-tool command (`echo $(pnpm -v)`) — accepted holes in a belt.
// ② schema-writes — the Write|Edit-matcher bypass wall. protect-audit-log
//   and require-lane-claim only see the file tools, so a write-shaped shell
//   command (`sed -i`, redirect INTO the tree, `rm`/`mv`/`cp`,
//   `git checkout --`) touching supabase/migrations|tests dodged both.
//   HEURISTIC BELT, not a vault (perl/python writers slip; copy-OUT blocks) —
//   stated trade, override is the escape hatch.
//
// Exit codes: 0 = allow, 2 = block. Fails open on any unexpected error — a
// broken hook must never block unrelated work.
// Overrides (per check): launch-time env CLAUDE_ALLOW_NO_CD=1 /
// CLAUDE_ALLOW_BASH_SCHEMA_WRITE=1 (the hook reads the HARNESS process env —
// a `VAR=1 cmd` shell prefix never reaches it), or the in-command marker
// `#ALLOW_NO_CD` / `#ALLOW_BASH_SCHEMA_WRITE` (auditable in the transcript).

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Node hook script
const fs = require("fs");

// --- check ① : cd-prefix -----------------------------------------------------

// A repo-anchored tool at the start of a chain segment, after leading env
// assignments are stripped. Segments split on && || ; | and newlines; quoted
// spans are blanked FIRST so tool words inside prose (`gh pr comment --body
// 'ran pnpm lint && pnpm test'`) never match.
const REPO_TOOL =
  /^(pnpm|npx|vitest|supabase|tsx)\b|^(bash|sh|node)\s+(\.\/)?scripts\/|^\.\/scripts\//;
const ENV_ASSIGN_PREFIX = /^(\w+=("[^"]*"|'[^']*'|\S*)\s+)*/;

// An absolute `cd` as the LITERAL first token (git-bash /d/… or Windows
// D:\…), tolerating quotes and a leading subshell paren.
const ANCHORED = /^\s*\(?\s*cd\s+["']?(\/[A-Za-z]|[A-Za-z]:[\\/])/;

function violatesCdPrefix(command) {
  if (process.env.CLAUDE_ALLOW_NO_CD) return false;
  if (/#ALLOW_NO_CD\b/.test(command)) return false;
  if (ANCHORED.test(command)) return false;

  const blanked = command.replace(/'[^']*'|"[^"]*"/g, " q ");
  const segments = blanked.split(/&&|\|\||[;|\n]/);
  return segments.some((seg) => REPO_TOOL.test(seg.trimStart().replace(ENV_ASSIGN_PREFIX, "")));
}

const CD_MESSAGE =
  "Blocked: repo-tool command without a leading absolute `cd` — on this box the shell cwd DRIFTS " +
  "between calls, so an unanchored pnpm/vitest/supabase/scripts command may run in the wrong " +
  "directory (worst case: a verification that measures nothing and reads as success).\n" +
  'Re-issue as: cd /d/claude/projects/prc-ops/<your worktree> && export PATH="/c/Program Files/nodejs:$PATH" && <command>\n' +
  "(`cd` must be the LITERAL first token — doctrine, Machine quirks.)\n" +
  "Genuinely cwd-independent? Append the marker `#ALLOW_NO_CD <why>` to the command " +
  "(or the operator launches the session with CLAUDE_ALLOW_NO_CD=1).\n";

// --- check ② : schema-writes -------------------------------------------------

// Protected tree, with or without a trailing slash (`rm -rf
// supabase/migrations` — no slash — was the review's sharpest hole).
const PROTECTED = /supabase\/(migrations|tests)(\/|["'\s]|$)/;
// A redirect whose TARGET is protected (a redirect elsewhere that merely
// MENTIONS the tree — pgTAP logs piped to /tmp — must pass).
const REDIRECT_INTO = />>?\s*["']?\S*supabase\/(migrations|tests)\//;
// Write-verbs that, combined with a protected path anywhere in the command,
// are treated as writes. cp/mv also block the copy-OUT direction — accepted
// over-blocking for a belt; the marker is the escape.
const WRITE_VERB =
  /\bsed\s+(-\w+\s+)*-i\b|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\btouch\b|\btee\s+(-\w+\s+)*["']?\S*supabase\/|\bgit\s+(checkout|restore)\b[^|;&\n]*supabase\/(migrations|tests)/;

function violatesSchemaWrites(command) {
  if (process.env.CLAUDE_ALLOW_BASH_SCHEMA_WRITE) return false;
  if (/#ALLOW_BASH_SCHEMA_WRITE\b/.test(command)) return false;

  const norm = command.replace(/\\/g, "/");
  if (!PROTECTED.test(norm)) return false;
  return REDIRECT_INTO.test(norm) || WRITE_VERB.test(norm);
}

const SCHEMA_MESSAGE =
  "Blocked: Bash-side write into supabase/migrations|tests — the audit-log and lane-claim guards " +
  "only see the Write/Edit tools, so shell writes would bypass them.\n" +
  "Use the Write or Edit tool for these files (the guards run there). Legitimate shell exception " +
  "(e.g. copying a file OUT of the tree)? Append the marker `#ALLOW_BASH_SCHEMA_WRITE <why>` " +
  "(or the operator launches with CLAUDE_ALLOW_BASH_SCHEMA_WRITE=1). Heuristic belt — it errs " +
  "toward blocking.\n";

// --- harness plumbing --------------------------------------------------------

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

  const command = event && event.tool_input && event.tool_input.command;
  if (typeof command !== "string") {
    return 0; // not a Bash command payload — not our concern
  }

  // Schema check first: its message is the more specific of the two.
  if (violatesSchemaWrites(command)) {
    process.stderr.write(SCHEMA_MESSAGE);
    return 2;
  }
  if (violatesCdPrefix(command)) {
    process.stderr.write(CD_MESSAGE);
    return 2;
  }
  return 0;
}

let code;
try {
  code = main();
} catch {
  code = 0; // any unexpected hook error — fail open
}
process.exit(code);
