// pgTAP runner for the linked Supabase project. Substitutes for
// `supabase test db --linked` which requires Docker. See ADR 0006.
//
// Strategy: for each test file under supabase/tests/database/*.test.sql,
// transform `select <pgtap_call>;` statements into
// `insert into _tap_buf(line) select <pgtap_call>;`, prefix the transaction
// with a temp collector table, and finalize with one
// `select line from _tap_buf order by ord;` so the Supabase Management API
// (which returns only the last result set) hands us the full TAP stream.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TESTS_DIR = "supabase/tests/database";

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
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status ?? 1,
  };
}

function parseResultJson(stdout: string): QueryResult | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < stdout.length; i++) {
    const c = stdout[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as QueryResult;
  } catch {
    return null;
  }
}

function ensurePgtap(tmpDir: string): boolean {
  const path = join(tmpDir, "00-ensure-pgtap.sql");
  writeFileSync(path, "create extension if not exists pgtap with schema extensions;\n");
  const r = runSupabaseQuery(["--file", path]);
  if (r.code !== 0) {
    console.error("Failed to ensure pgtap extension:");
    console.error(r.stderr || r.stdout);
    return false;
  }
  return true;
}

// Split SQL into top-level statements, respecting `$$ ... $$` dollar quotes
// and `-- line` comments. Adequate for the pgTAP test idioms we use.
function splitStatements(sql: string): string[] {
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

function normalizeForKeyword(stmt: string): string {
  return stmt.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function transformPgtap(sql: string): string {
  const stmts = splitStatements(sql);
  const out: string[] = [];
  let beginSeen = false;
  for (const stmt of stmts) {
    const k = normalizeForKeyword(stmt);
    if (
      k === "begin;" ||
      k === "begin transaction;" ||
      k.startsWith("begin ") ||
      k === "start transaction;"
    ) {
      out.push(stmt);
      out.push("create temp table if not exists _tap_buf (ord serial primary key, line text);");
      beginSeen = true;
      continue;
    }
    if (k === "rollback;" || k.startsWith("rollback ") || k === "commit;") {
      out.push("select line from _tap_buf order by ord;");
      out.push(stmt);
      continue;
    }
    if (k.startsWith("select ")) {
      const body = stmt.replace(/;\s*$/, "");
      out.push(`insert into _tap_buf(line) ${body};`);
      continue;
    }
    out.push(stmt);
  }
  if (!beginSeen) {
    throw new Error("Test file must start with begin;");
  }
  return out.join("\n") + "\n";
}

interface TestRunResult {
  file: string;
  passed: boolean;
  assertions: number;
  failures: number;
  output: string[];
  error?: string;
}

function runTest(file: string, tmpDir: string): TestRunResult {
  const original = readFileSync(join(TESTS_DIR, file), "utf8");
  let transformed: string;
  try {
    transformed = transformPgtap(original);
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
  const tmpPath = join(tmpDir, file);
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
    return {
      file,
      passed: false,
      assertions: 0,
      failures: 1,
      output: [],
      error: errMsg,
    };
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
  for (const row of parsed.rows) {
    const v = Object.values(row)[0];
    if (typeof v !== "string") continue;
    lines.push(v);
    if (v.startsWith("ok ")) assertions++;
    else if (v.startsWith("not ok ")) {
      assertions++;
      failures++;
    }
  }
  return {
    file,
    passed: failures === 0,
    assertions,
    failures,
    output: lines,
  };
}

function main(): void {
  const tmp = mkdtempSync(join(tmpdir(), "pgtap-"));
  if (!ensurePgtap(tmp)) process.exit(2);

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

  const results: TestRunResult[] = [];
  for (const file of files) {
    console.log(`# ${file}`);
    const r = runTest(file, tmp);
    results.push(r);
    if (r.error) {
      console.log(`# ERROR: ${r.error}`);
      console.log(`not ok - ${file}`);
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

  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main();
