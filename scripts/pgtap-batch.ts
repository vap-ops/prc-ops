// Pure SQL generation + output parsing for the batched pgTAP runner
// (scripts/run-pgtap.ts). Side-effect free so it is unit-tested in
// tests/unit/pgtap-batch.test.ts without touching the shared remote DB.
//
// Why batch: the runner drives the linked Supabase project through the
// Management API (`supabase db query --linked`), which spawns the Supabase CLI
// cold once per file. At 255 files that was ~30 min of CI (ADR 0081 made pgTAP a
// required gate; this is the follow-up). Batching packs many files into ONE
// invocation.
//
// The hard part: the Management API returns only the LAST result set of a
// multi-statement script, yet each file must keep its own begin…rollback
// isolation (ADR 0006 — no test data may persist, and files must not see each
// other's fixtures). We wrap each file in a pg_temp plpgsql function that buffers
// its TAP into a temp table, `RETURN QUERY`s the buffer, then RAISEs a sentinel
// to roll back that file's data. A plpgsql function's returned rows live in a
// tuplestore that SURVIVES the subtransaction rollback (verified against the live
// DB), so every file's TAP reaches one `_tap_out` collector and the single final
// SELECT the API hands back. pgTAP's own per-test state resets with each rollback,
// so file N+1 starts numbering at 1 again (also verified live).
//
// Two classes of file can't take the wrapped path, and both degrade to the
// unchanged per-file path (`buildRawFileSql`) with no loss of correctness:
//   1. Top-level `DO` blocks — a `DO` statement is illegal inside a plpgsql body,
//      so the wrapper fails to COMPILE and would abort its whole chunk. These are
//      detected up front by `hasTopLevelDo` and never batched.
//   2. Top-level row-returning statements the transform passes through unchanged
//      (a `WITH … SELECT` CTE assertion, bare `VALUES`/`TABLE`). Raw SQL tolerates
//      these (the Management API just discards the intermediate result set — the
//      pre-batch runner did the same), but plpgsql rejects a bare query with "no
//      destination for result data". The wrapper's exception handler catches that
//      at RUNTIME and emits a BODY_ERROR marker, so only that file — not its chunk
//      — falls back. run-pgtap re-runs any such file per-file, matching the old
//      behaviour exactly (including how those CTE assertions were already handled).

/** Custom SQLSTATE raised to roll back a file's data while its buffered TAP
 *  survives. A dedicated error CODE (not a message string) so a test whose own
 *  error text happens to equal a sentinel cannot be mistaken for the undo signal:
 *  the handler dispatches on `sqlstate`, and no pgTAP idiom raises this code. */
const UNDO_SQLSTATE = "PT001";
/** Unique dollar-quote tag for the wrapper function body — must not collide with
 *  any tag a test file uses ($$, $f$, $json$ are all in the corpus). */
const FN_TAG = "$prcpgtap$";

/** Prefixes for the rows emitted around each file's output so the runner can split
 *  the combined stream back into per-file TAP. The full marker is
 *  `<prefix><nonce>:<file>` — the per-run nonce makes markers unforgeable by test
 *  content (see parseChunkRows). */
export const FILE_BEGIN = ">>>PGTAP:BEGIN:";
export const FILE_END = ">>>PGTAP:END:";
/** Emitted from a wrapper's exception handler (as `<prefix><nonce>:<message>`) when
 *  the file hit a real SQL error (not the undo signal). Maps to "file errored". */
export const BODY_ERROR = ">>>PGTAP:ERROR:";

export interface ChunkEntry {
  /** Fully-qualified pg_temp function name, e.g. "pg_temp._prc_f0". */
  fnName: string;
  /** readdir basename, used in the begin/end markers. */
  file: string;
  /** Pre-split statements of the original file. */
  statements: string[];
}

export interface ParsedFile {
  file: string;
  lines: string[];
  assertions: number;
  failures: number;
  /** The file hit a real SQL error (BODY_ERROR marker) rather than plain asserts. */
  errored: boolean;
  /** Both begin and end markers were seen — the chunk produced this file's output.
   *  When false the runner must re-run the file individually. */
  accounted: boolean;
}

// Split SQL into top-level statements, respecting `$$ … $$` dollar quotes and
// `-- line` comments. Adequate for the pgTAP test idioms we use (a nested tag such
// as `$json$` inside a `$$ … $$` region carries no bare `$$`, so it is inert).
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inDollar = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (sql.slice(i, i + 2) === "$$") {
      inDollar = !inDollar;
      buf += "$$";
      i += 2;
      continue;
    }
    if (!inDollar && ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl < 0) {
        buf += sql.slice(i);
        i = sql.length;
      } else {
        buf += sql.slice(i, nl + 1);
        i = nl + 1;
      }
      continue;
    }
    if (!inDollar && ch === ";") {
      buf += ";";
      const t = buf.trim();
      if (t.length > 0) out.push(t);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

export function normalizeForKeyword(stmt: string): string {
  return stmt.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isBegin(k: string): boolean {
  return (
    k === "begin;" ||
    k === "begin transaction;" ||
    k.startsWith("begin ") ||
    k === "start transaction;"
  );
}

function isRollback(k: string): boolean {
  return k === "rollback;" || k.startsWith("rollback ");
}

function isCommit(k: string): boolean {
  // END / END TRANSACTION / END WORK are Postgres synonyms for COMMIT and would
  // persist test data just as COMMIT would — refuse them too. (A CASE…END or a
  // block END is never a top-level statement, so it normalizes with a leading
  // keyword like "select …", not "end".)
  return (
    k === "commit;" ||
    k.startsWith("commit ") ||
    k === "end;" ||
    k === "end" ||
    k.startsWith("end ")
  );
}

/**
 * Enforce the ADR 0006 safety envelope on a file's statements: no COMMIT (which
 * would let test data persist), exactly one BEGIN, and a closing ROLLBACK. Throws
 * on violation — the only paths through either transform end in a rollback.
 */
export function assertSafe(statements: string[]): void {
  let beginSeen = false;
  let rollbackSeen = false;
  for (const stmt of statements) {
    const k = normalizeForKeyword(stmt);
    if (isCommit(k)) {
      throw new Error(
        "Test file contains COMMIT/END — test transactions must end with ROLLBACK so no data persists.",
      );
    }
    if (isBegin(k)) {
      if (beginSeen) throw new Error("Test file has more than one BEGIN statement.");
      beginSeen = true;
      continue;
    }
    if (isRollback(k)) {
      rollbackSeen = true;
    }
  }
  if (!beginSeen) throw new Error("Test file must start with begin;");
  if (!rollbackSeen) {
    throw new Error("Test file must end with rollback; (no commit, no implicit close).");
  }
}

/** True if any top-level statement is a `DO` block — those cannot be wrapped in a
 *  plpgsql function and must take the per-file raw path. */
export function hasTopLevelDo(statements: string[]): boolean {
  return statements.some((s) => {
    const k = normalizeForKeyword(s);
    return k === "do" || k.startsWith("do ") || k.startsWith("do$");
  });
}

/**
 * Rewrite a WITH-led statement whose terminal top-level clause is a SELECT so its
 * result set is collected: `with … select …` → `with … insert into _tap_buf(line)
 * select …`. Postgres permits an INSERT under a top-level WITH even when a CTE
 * modifies data — which is exactly the pgTAP idiom this rescues (`with u as
 * (update … returning 1) select is(count(*), …)`): before this, the assert RAN but
 * its TAP line fell out of the single collected result set, so 261/288 silently
 * reported fewer tests than planned. Returns null when the statement is not
 * WITH-led or its terminal clause is not a depth-0 SELECT (those run verbatim).
 */
export function rewriteWithSelect(stmt: string): string | null {
  if (!normalizeForKeyword(stmt).startsWith("with ")) return null;
  let depth = 0;
  let i = 0;
  while (i < stmt.length) {
    const ch = stmt[i];
    const two = stmt.slice(i, i + 2);
    if (two === "--") {
      const nl = stmt.indexOf("\n", i);
      i = nl < 0 ? stmt.length : nl + 1;
      continue;
    }
    if (two === "/*") {
      const end = stmt.indexOf("*/", i + 2);
      i = end < 0 ? stmt.length : end + 2;
      continue;
    }
    if (ch === "'") {
      // E'…' strings also escape with backslash; plain '…' only with ''.
      const isEString = /e$/i.test(stmt.slice(0, i)) && !/[\w$]e$/i.test(stmt.slice(0, i));
      i++;
      while (i < stmt.length) {
        if (isEString && stmt[i] === "\\") i += 2;
        else if (stmt[i] === "'" && stmt[i + 1] === "'") i += 2;
        else if (stmt[i] === "'") break;
        else i++;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      const end = stmt.indexOf('"', i + 1);
      i = end < 0 ? stmt.length : end + 1;
      continue;
    }
    if (ch === "$") {
      // Tag grammar: $$ or $tag$ where tag starts with a letter/underscore and
      // may CONTAIN digits ($q1$ is legal).
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(stmt.slice(i));
      if (m) {
        const tag = m[0];
        const end = stmt.indexOf(tag, i + tag.length);
        i = end < 0 ? stmt.length : end + tag.length;
        continue;
      }
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0) {
      const prev = i === 0 ? " " : (stmt[i - 1] ?? " ");
      if (/[\s),]/.test(prev)) {
        // A depth-0 DML keyword means the WITH's main query is INSERT/UPDATE/
        // DELETE/MERGE — a later depth-0 `select` (e.g. INSERT … SELECT's
        // source) is NOT a terminal result query. Splicing there would emit
        // invalid SQL; leave the statement verbatim.
        if (/^(insert|update|delete|merge)\b/i.test(stmt.slice(i))) return null;
        if (/^select\b/i.test(stmt.slice(i))) {
          return `${stmt.slice(0, i)}insert into _tap_buf(line) ${stmt.slice(i)}`;
        }
      }
    }
    i++;
  }
  return null;
}

// Middle statements (between begin and rollback), rewritten so every assertion
// `select` collects into `_tap_buf` and everything else runs verbatim. Shared by
// the batch wrapper and the raw fallback so the two agree statement-for-statement.
function collectStatements(statements: string[]): string[] {
  const out: string[] = [];
  for (const stmt of statements) {
    const k = normalizeForKeyword(stmt);
    if (isBegin(k) || isRollback(k)) continue;
    if (k.startsWith("select ")) {
      out.push(`insert into _tap_buf(line) ${stmt.replace(/;\s*$/, "")};`);
      continue;
    }
    const withRewrite = rewriteWithSelect(stmt);
    if (withRewrite !== null) {
      out.push(withRewrite);
      continue;
    }
    out.push(stmt);
  }
  return out;
}

/**
 * The unchanged per-file script (parity with the pre-batch runner): one
 * begin…rollback, a `_tap_buf` collector, and a single final select. Used for
 * DO-block files and as the fallback when a batch fails to account for a file.
 */
export function buildRawFileSql(statements: string[]): string {
  assertSafe(statements);
  const lines = [
    "begin;",
    "create temp table if not exists _tap_buf (ord serial primary key, line text);",
    ...collectStatements(statements),
    "select line from _tap_buf order by ord;",
    "rollback;",
  ];
  return lines.join("\n") + "\n";
}

/**
 * Wrap one file in a pg_temp function returning its TAP as setof text. The inner
 * `begin … exception` block is a subtransaction: it buffers the file's TAP,
 * RETURN QUERYs it (those rows survive), then RAISEs the undo sentinel so the
 * file's data changes roll back. A real error (anything but the sentinel) is
 * surfaced as a single BODY_ERROR line.
 */
export function buildFileFunctionSql(fnName: string, nonce: string, statements: string[]): string {
  assertSafe(statements);
  const inner = collectStatements(statements)
    .map((s) => `    ${s}`)
    .join("\n");
  return [
    `create or replace function ${fnName}() returns setof text language plpgsql as ${FN_TAG}`,
    "begin",
    "  begin",
    "    create temp table if not exists _tap_buf (ord serial primary key, line text);",
    "    truncate _tap_buf restart identity;",
    inner,
    "    return query select line from _tap_buf order by ord;",
    `    raise exception using errcode = '${UNDO_SQLSTATE}', message = 'pgtap undo';`,
    "  exception",
    `    when sqlstate '${UNDO_SQLSTATE}' then`,
    "      return;",
    "    when others then",
    `      return query select '${BODY_ERROR}${nonce}:' || replace(coalesce(sqlerrm, ''), chr(10), ' ');`,
    "  end;",
    "end;",
    `${FN_TAG};`,
  ].join("\n");
}

/**
 * Assemble one chunk: every file's wrapper function, each called between its
 * begin/end markers, all collected into `_tap_out`, ending with the single final
 * select the Management API returns. The whole chunk is one begin…rollback so
 * `_tap_out` itself never commits — a second backstop behind each file's own
 * sentinel rollback.
 */
export function buildChunkSql(entries: ChunkEntry[], nonce: string): string {
  const parts: string[] = [
    "begin;",
    "create temp table _tap_out (ord bigserial primary key, line text);",
  ];
  for (const e of entries) {
    const file = e.file.replace(/'/g, "''");
    parts.push(buildFileFunctionSql(e.fnName, nonce, e.statements));
    parts.push(`insert into _tap_out(line) values ('${FILE_BEGIN}${nonce}:${file}');`);
    parts.push(`insert into _tap_out(line) select * from ${e.fnName}();`);
    parts.push(`insert into _tap_out(line) values ('${FILE_END}${nonce}:${file}');`);
  }
  parts.push("select line from _tap_out order by ord;");
  parts.push("rollback;");
  return parts.join("\n") + "\n";
}

/**
 * Split a chunk's combined output rows back into per-file results. `expectedFiles`
 * is every file the chunk was asked to run, so files whose markers never appeared
 * (a chunk that aborted early) come back `accounted: false` for the runner to
 * re-run individually. Rows may carry embedded newlines (pgTAP diagnostics); each
 * physical line is counted separately.
 */
export function parseChunkRows(
  rowValues: string[],
  expectedFiles: string[],
  nonce: string,
): ParsedFile[] {
  // Markers carry a per-run nonce the test corpus cannot know, so a test that
  // prints a `>>>PGTAP:…` line can neither forge a boundary nor spoof another
  // file's output. An expected-set check is a second guard against a stray marker.
  const beginPrefix = `${FILE_BEGIN}${nonce}:`;
  const endPrefix = `${FILE_END}${nonce}:`;
  const errorPrefix = `${BODY_ERROR}${nonce}:`;
  const expected = new Set(expectedFiles);
  const byFile = new Map<string, ParsedFile & { beginSeen: boolean; endSeen: boolean }>();
  let current: (ParsedFile & { beginSeen: boolean; endSeen: boolean }) | null = null;

  const get = (file: string) => {
    let rec = byFile.get(file);
    if (!rec) {
      rec = {
        file,
        lines: [],
        assertions: 0,
        failures: 0,
        errored: false,
        accounted: false,
        beginSeen: false,
        endSeen: false,
      };
      byFile.set(file, rec);
    }
    return rec;
  };

  for (const raw of rowValues) {
    for (const line of raw.split("\n")) {
      if (line.startsWith(beginPrefix)) {
        const name = line.slice(beginPrefix.length);
        if (!expected.has(name)) continue;
        current = get(name);
        current.beginSeen = true;
        continue;
      }
      if (line.startsWith(endPrefix)) {
        const name = line.slice(endPrefix.length);
        if (current && current.file === name) current.endSeen = true;
        current = null;
        continue;
      }
      if (!current) continue;
      if (line.startsWith(errorPrefix)) {
        current.errored = true;
        current.lines.push(line);
        continue;
      }
      current.lines.push(line);
      if (line.startsWith("ok ")) current.assertions++;
      else if (line.startsWith("not ok ")) {
        current.assertions++;
        current.failures++;
      }
    }
  }

  return expectedFiles.map((file) => {
    const rec = get(file);
    return {
      file: rec.file,
      lines: rec.lines,
      assertions: rec.assertions,
      failures: rec.failures,
      errored: rec.errored,
      accounted: rec.beginSeen && rec.endSeen,
    };
  });
}
