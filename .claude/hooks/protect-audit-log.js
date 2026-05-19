#!/usr/bin/env node
"use strict";

// PreToolUse hook — protects audit_log migrations.
//
// audit_log is append-only (ADR 0004). This hook blocks Write/Edit on any
// migration file whose path matches an audit_log migration, unless the
// CLAUDE_ALLOW_AUDIT_LOG_EDIT environment variable is set.
//
// Exit codes: 0 = allow, 2 = block. The hook fails open — any unexpected
// error exits 0 so a broken hook never blocks unrelated work.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS Node hook script
const fs = require("fs");

const AUDIT_LOG_MIGRATION = /supabase\/migrations\/.*audit[_-]?log.*/i;

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

  // Normalise separators so the regex matches on Windows and POSIX alike.
  const normalised = filePath.replace(/\\/g, "/");
  if (!AUDIT_LOG_MIGRATION.test(normalised)) {
    return 0; // not an audit_log migration
  }

  if (process.env.CLAUDE_ALLOW_AUDIT_LOG_EDIT) {
    return 0; // explicit override
  }

  process.stderr.write(
    "Blocked: audit_log migrations are protected — audit_log is append-only (ADR 0004).\n" +
      "Set CLAUDE_ALLOW_AUDIT_LOG_EDIT=1 to override if this edit is intentional.\n",
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
