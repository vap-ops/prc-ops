// pgTAP runner for the linked Supabase project. Substitutes for
// `supabase test db --linked` which requires Docker. See ADR 0006.
//
// Strategy (batched — ADR 0081 follow-up): the Supabase Management API
// (`supabase db query --linked`) spawns the CLI cold once per invocation, so the
// old one-file-per-invocation design cost ~30 min on CI for 255 files. We now pack
// many files into ONE invocation. Each file is wrapped in a pg_temp plpgsql
// function that buffers its TAP, RETURN QUERYs it, then RAISEs a sentinel to roll
// back its own data — the returned rows survive the subtransaction rollback, so
// every file's TAP lands in one `_tap_out` collector and the single final result
// set the API returns. Per-file begin…rollback isolation and the "no data may
// persist" guarantee are preserved (see scripts/pgtap-batch.ts).
//
// Files with a top-level DO block (illegal inside a plpgsql body) run on the
// unchanged per-file path, as does any file a chunk fails to cleanly account for —
// so the worst case is exactly the pre-batch behaviour. The count-based known-red
// allowlist verdict (scripts/pgtap-report.ts) is unchanged.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertSafe,
  buildChunkSql,
  buildRawFileSql,
  hasTopLevelDo,
  parseChunkRows,
  splitStatements,
  type ChunkEntry,
} from "./pgtap-batch";
import { loadKnownRed, partitionResults, type FileResult } from "./pgtap-report";

const TESTS_DIR = "supabase/tests/database";
// Pinned pre-existing reds tolerated in CI (see scripts/pgtap-report.ts + ADR 0081).
const KNOWN_RED_MANIFEST = "supabase/tests/known-red.json";

// Files per batched CLI invocation. Bigger amortizes more cold-spawn overhead but
// grows the single API request (payload + runtime), which must stay under the
// Management API's per-request timeout. Tunable via env for the shared-DB gate.
const CHUNK_SIZE = (() => {
  const n = Number.parseInt(process.env.PGTAP_CHUNK_SIZE ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : 20;
})();

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  warning?: string;
}

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runSupabaseQuery(args: string[]): CliResult {
  const r = spawnSync(
    "pnpm",
    ["exec", "supabase", "db", "query", "--linked", ...args, "-o", "json"],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status ?? 1,
  };
}

function parseResultJson(stdout: string): QueryResult | null {
  // Skip preamble like "Initialising login role..." by locating whichever
  // JSON delimiter (`[` or `{`) appears first. The CLI returns a bare array
  // for plain `db query` and a `{ rows, ... }` object in agent mode.
  const objStart = stdout.indexOf("{");
  const arrStart = stdout.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";
  if (objStart < 0 && arrStart < 0) return null;
  if (objStart < 0 || (arrStart >= 0 && arrStart < objStart)) {
    start = arrStart;
    open = "[";
    close = "]";
  } else {
    start = objStart;
    open = "{";
    close = "}";
  }
  let depth = 0;
  let end = -1;
  for (let i = start; i < stdout.length; i++) {
    const c = stdout[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
    if (open === "[") {
      if (!Array.isArray(parsed)) return null;
      return { rows: parsed as Array<Record<string, unknown>> };
    }
    if (typeof parsed === "object" && parsed !== null && "rows" in parsed) {
      const rows = (parsed as { rows: unknown }).rows;
      if (Array.isArray(rows)) return parsed as QueryResult;
    }
    return null;
  } catch {
    return null;
  }
}

function rowsToLines(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => {
    const v = Object.values(row)[0];
    return typeof v === "string" ? v : "";
  });
}

interface TestRunResult {
  file: string;
  passed: boolean;
  assertions: number;
  failures: number;
  output: string[];
  error?: string;
}

// The unchanged single-file path: one CLI invocation for one file. Used for
// DO-block files and as the fallback for any file a chunk did not cleanly account
// for. Behaviour matches the pre-batch runner.
function runTestRaw(file: string): TestRunResult {
  let transformed: string;
  try {
    const original = readFileSync(join(TESTS_DIR, file), "utf8");
    transformed = buildRawFileSql(splitStatements(original));
  } catch (e) {
    return {
      file,
      passed: false,
      assertions: 0,
      failures: 1,
      output: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const tmpPath = join(mkdtempSync(join(tmpdir(), "pgtap-raw-")), file);
  writeFileSync(tmpPath, transformed);

  const r = runSupabaseQuery(["--file", tmpPath]);
  if (r.code !== 0) {
    const errMsg =
      (r.stderr + r.stdout)
        .split("\n")
        .filter(
          (l) => l.includes("ERROR") || l.includes("error") || l.includes("unexpected status"),
        )
        .slice(0, 8)
        .join("\n") || `${r.stderr}${r.stdout}`.trim();
    return { file, passed: false, assertions: 0, failures: 1, output: [], error: errMsg };
  }

  const parsed = parseResultJson(r.stdout);
  if (!parsed || !Array.isArray(parsed.rows)) {
    return {
      file,
      passed: false,
      assertions: 0,
      failures: 1,
      output: [],
      error: "Could not parse query result.",
    };
  }

  const lines: string[] = [];
  let assertions = 0;
  let failures = 0;
  for (const v of rowsToLines(parsed.rows)) {
    if (v.length === 0) continue;
    lines.push(v);
    if (v.startsWith("ok ")) assertions++;
    else if (v.startsWith("not ok ")) {
      assertions++;
      failures++;
    }
  }
  return { file, passed: failures === 0, assertions, failures, output: lines };
}

interface Fallback {
  file: string;
  reason: string;
}

// Run one chunk in a single CLI invocation. Returns the files it cleanly resolved
// plus the files that must fall back to per-file (chunk aborted, markers missing,
// or the file hit a real SQL error the raw path should re-adjudicate).
function runChunk(
  entries: ChunkEntry[],
  tmpDir: string,
  chunkIdx: number,
  nonce: string,
): {
  accepted: TestRunResult[];
  fallback: Fallback[];
} {
  const files = entries.map((e) => e.file);
  const tmpPath = join(tmpDir, `chunk-${chunkIdx}.sql`);
  writeFileSync(tmpPath, buildChunkSql(entries, nonce));

  const r = runSupabaseQuery(["--file", tmpPath]);
  if (r.code !== 0) {
    const snippet =
      (r.stderr + r.stdout)
        .split("\n")
        .filter((l) => l.includes("ERROR") || l.includes("error"))
        .slice(0, 3)
        .join(" | ") || "non-zero exit";
    console.log(
      `# chunk ${chunkIdx} failed (${snippet}) — re-running its ${files.length} files individually`,
    );
    return { accepted: [], fallback: files.map((file) => ({ file, reason: "chunk-error" })) };
  }

  const parsed = parseResultJson(r.stdout);
  if (!parsed || !Array.isArray(parsed.rows)) {
    console.log(
      `# chunk ${chunkIdx} unparseable — re-running its ${files.length} files individually`,
    );
    return { accepted: [], fallback: files.map((file) => ({ file, reason: "unparseable" })) };
  }

  const accepted: TestRunResult[] = [];
  const fallback: Fallback[] = [];
  for (const pf of parseChunkRows(rowsToLines(parsed.rows), files, nonce)) {
    if (!pf.accounted || pf.errored) {
      fallback.push({ file: pf.file, reason: pf.errored ? "errored" : "unaccounted" });
      continue;
    }
    accepted.push({
      file: pf.file,
      passed: pf.failures === 0,
      assertions: pf.assertions,
      failures: pf.failures,
      output: pf.lines,
    });
  }
  return { accepted, fallback };
}

function main(): void {
  const tmp = mkdtempSync(join(tmpdir(), "pgtap-"));

  let files: string[];
  try {
    files = readdirSync(TESTS_DIR)
      .filter((f) => f.endsWith(".test.sql"))
      .sort();
  } catch (e) {
    console.error(`Failed to read ${TESTS_DIR}:`, e);
    process.exit(2);
    return;
  }

  if (files.length === 0) {
    console.log("No pgTAP test files found.");
    process.exit(0);
  }

  // Classify: files failing the safety envelope error out immediately; DO-block
  // files take the raw per-file path; the rest are batchable.
  const results: TestRunResult[] = [];
  const rawFiles: string[] = [];
  const batchEntries: ChunkEntry[] = [];
  let fnIdx = 0;
  for (const file of files) {
    let statements: string[];
    try {
      statements = splitStatements(readFileSync(join(TESTS_DIR, file), "utf8"));
      assertSafe(statements);
    } catch (e) {
      results.push({
        file,
        passed: false,
        assertions: 0,
        failures: 1,
        output: [],
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    if (hasTopLevelDo(statements)) rawFiles.push(file);
    else batchEntries.push({ fnName: `pg_temp._prc_f${fnIdx++}`, file, statements });
  }

  // Batched fast path. A per-run nonce makes the per-file markers unforgeable by
  // any test's own output (see parseChunkRows).
  const nonce = randomUUID().replace(/-/g, "");
  const fallbacks: Fallback[] = [];
  let chunkIdx = 0;
  const chunkCount = Math.ceil(batchEntries.length / CHUNK_SIZE);
  for (let i = 0; i < batchEntries.length; i += CHUNK_SIZE) {
    const chunk = batchEntries.slice(i, i + CHUNK_SIZE);
    const { accepted, fallback } = runChunk(chunk, tmp, chunkIdx++, nonce);
    results.push(...accepted);
    fallbacks.push(...fallback);
  }

  // Per-file path: DO-block files + anything the batches did not resolve.
  for (const file of [...rawFiles, ...fallbacks.map((f) => f.file)]) results.push(runTestRaw(file));

  console.log(
    `# Batched ${batchEntries.length} files in ${chunkCount} chunk(s) of ≤${CHUNK_SIZE}; ` +
      `${rawFiles.length} DO-block + ${fallbacks.length} fallback ran per-file.`,
  );
  if (fallbacks.length > 0) {
    console.log(`# Fallback: ${fallbacks.map((f) => `${f.file} (${f.reason})`).join(", ")}`);
  }

  results.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const r of results) {
    console.log(`# ${r.file}`);
    if (r.error) {
      console.log(`# ERROR: ${r.error}`);
      console.log(`not ok - ${r.file}`);
    } else {
      for (const line of r.output) console.log(line);
    }
    console.log("");
  }

  const totalAssertions = results.reduce((s, r) => s + r.assertions, 0);
  const totalFailures = results.reduce((s, r) => s + r.failures, 0);
  const filesPassed = results.filter((r) => r.passed).length;

  console.log(
    `# Files: ${results.length} (${filesPassed} passed, ${results.length - filesPassed} failed)`,
  );
  console.log(`# Assertions: ${totalAssertions} (${totalFailures} failures)`);

  // A CI run passes iff EXACTLY the allowlisted pre-existing reds fail. Any other
  // red file fails the check; an allowlisted file that now passes is surfaced so
  // the quarantine list can be pruned. Fail-closed: a missing manifest tolerates
  // nothing.
  const knownRed = loadKnownRed(KNOWN_RED_MANIFEST);
  const fileResults: FileResult[] = results.map((r) => ({
    file: r.file,
    // A runner ERROR (transform/connection blip) is not a normal assertion red
    // and must never be masked by a file's budget — count it as infinite
    // failures so an allowlisted file cannot swallow it.
    failures: r.error ? Number.POSITIVE_INFINITY : r.failures,
  }));
  const verdict = partitionResults(fileResults, knownRed);

  if (verdict.expectedFailures.length > 0) {
    console.log(
      `# Known-red (tolerated ${verdict.expectedFailures.length}): ${verdict.expectedFailures.join(", ")}`,
    );
  }
  if (verdict.unexpectedPasses.length > 0) {
    console.log(
      `# Allowlisted but now PASSING — remove from ${KNOWN_RED_MANIFEST}: ${verdict.unexpectedPasses.join(", ")}`,
    );
  }
  if (verdict.unexpectedFailures.length > 0) {
    console.log(
      `# FAIL — unexpected red (${verdict.unexpectedFailures.length}): ${verdict.unexpectedFailures.join(", ")}`,
    );
  }

  process.exit(verdict.ok ? 0 : 1);
}

main();
