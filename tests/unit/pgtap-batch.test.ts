import { describe, expect, it } from "vitest";

import {
  assertSafe,
  buildChunkSql,
  buildFileFunctionSql,
  buildRawFileSql,
  FILE_BEGIN,
  FILE_END,
  BODY_ERROR,
  hasTopLevelDo,
  parseChunkRows,
  splitStatements,
} from "../../scripts/pgtap-batch";

// The batch runner packs many pgTAP files into ONE `supabase db query` invocation
// (255 cold CLI spawns was ~30 min of CI; ADR 0081 follow-up). It wraps each file
// in a pg_temp plpgsql function that buffers its TAP, RETURN QUERYs it, then RAISEs
// a sentinel to roll back that file's data — the returned rows survive the
// subtransaction rollback (verified against the live DB), so every file's TAP
// reaches the ONE final result set the Management API returns. These tests lock the
// pure SQL-generation + output-parsing; the DB round-trip is exercised by db:test.

describe("splitStatements", () => {
  it("splits on top-level semicolons", () => {
    expect(splitStatements("select 1; select 2;")).toEqual(["select 1;", "select 2;"]);
  });

  it("ignores semicolons inside $$ dollar quotes", () => {
    const s = splitStatements("select throws_ok($$ insert into t values (1); delete from t; $$);");
    expect(s).toHaveLength(1);
  });

  it("ignores semicolons inside -- line comments", () => {
    expect(splitStatements("select 1; -- a; b; c\nselect 2;")).toHaveLength(2);
  });
});

describe("assertSafe (ADR 0006 — no data may persist)", () => {
  it("refuses a file containing COMMIT", () => {
    expect(() => assertSafe(splitStatements("begin; select 1; commit;"))).toThrow(/COMMIT/);
  });

  it("refuses COMMIT with a trailing clause (commit and chain)", () => {
    expect(() => assertSafe(splitStatements("begin; commit and chain; rollback;"))).toThrow(
      /COMMIT/,
    );
  });

  it("refuses a file with no begin", () => {
    expect(() => assertSafe(splitStatements("select 1; rollback;"))).toThrow(/begin/i);
  });

  it("refuses a file missing a closing rollback", () => {
    expect(() => assertSafe(splitStatements("begin; select 1;"))).toThrow(/rollback/i);
  });

  it("refuses more than one begin", () => {
    expect(() => assertSafe(splitStatements("begin; begin; select 1; rollback;"))).toThrow(
      /more than one BEGIN/i,
    );
  });

  it("refuses END / END TRANSACTION / END WORK (COMMIT synonyms that persist data)", () => {
    expect(() => assertSafe(splitStatements("begin; insert into t values (1); end;"))).toThrow(
      /COMMIT|END/i,
    );
    expect(() => assertSafe(splitStatements("begin; end transaction; rollback;"))).toThrow(
      /COMMIT|END/i,
    );
    expect(() => assertSafe(splitStatements("begin; end work; rollback;"))).toThrow(/COMMIT|END/i);
  });

  it("does not mistake a CASE…END expression for a transaction END", () => {
    expect(() =>
      assertSafe(
        splitStatements(
          "begin; select case when true then 1 else 0 end; select * from finish(); rollback;",
        ),
      ),
    ).not.toThrow();
  });

  it("accepts a well-formed pgTAP file", () => {
    expect(() =>
      assertSafe(
        splitStatements(
          "begin; select plan(1); select ok(true); select * from finish(); rollback;",
        ),
      ),
    ).not.toThrow();
  });
});

describe("hasTopLevelDo (route these to the per-file raw fallback)", () => {
  it("detects a top-level DO block (illegal inside a plpgsql wrapper)", () => {
    expect(hasTopLevelDo(splitStatements("begin; do $$ begin perform 1; end $$; rollback;"))).toBe(
      true,
    );
  });

  it("is false for a normal assertion file", () => {
    expect(
      hasTopLevelDo(splitStatements("begin; select ok(true); select * from finish(); rollback;")),
    ).toBe(false);
  });
});

describe("buildFileFunctionSql", () => {
  const stmts = splitStatements(
    "begin; select plan(1); insert into t values (1); select ok(true, 'x'); select * from finish(); rollback;",
  );
  const fn = buildFileFunctionSql("pg_temp._prc_f0", "N0", stmts);

  it("defines a plpgsql function returning setof text", () => {
    expect(fn).toMatch(
      /create or replace function pg_temp\._prc_f0\(\)\s+returns setof text language plpgsql/i,
    );
  });

  it("rewrites every assertion select into a _tap_buf insert", () => {
    expect(fn).toContain("insert into _tap_buf(line) select plan(1)");
    expect(fn).toContain("insert into _tap_buf(line) select ok(true, 'x')");
    expect(fn).toContain("insert into _tap_buf(line) select * from finish()");
  });

  it("keeps non-select setup statements verbatim", () => {
    expect(fn).toContain("insert into t values (1);");
  });

  it("strips the raw begin/rollback (the plpgsql subtransaction replaces them)", () => {
    expect(fn.toLowerCase()).not.toContain("rollback");
    // no bare 'begin;' statement — only plpgsql block 'begin' keywords (no semicolon)
    expect(fn).not.toMatch(/^\s*begin;\s*$/m);
  });

  it("returns the buffer then raises the undo signal to discard the file's data", () => {
    expect(fn).toContain("return query select line from _tap_buf order by ord");
    expect(fn).toContain("raise exception using errcode = 'PT001'");
  });

  it("dispatches the undo signal on SQLSTATE, not a spoofable message string", () => {
    // A test whose own error text matched a sentinel string would otherwise be
    // swallowed as the undo signal (masked pass). SQLSTATE dispatch closes that.
    expect(fn).toContain("when sqlstate 'PT001'");
    expect(fn).not.toContain("sqlerrm =");
  });

  it("emits an ERROR marker line from the exception handler for a real error", () => {
    expect(fn).toContain(BODY_ERROR);
  });

  it("refuses a file containing COMMIT (safety travels with the transform)", () => {
    expect(() =>
      buildFileFunctionSql("pg_temp._x", "N0", splitStatements("begin; commit; rollback;")),
    ).toThrow(/COMMIT/);
  });
});

describe("buildRawFileSql (unchanged per-file fallback, parity with the old runner)", () => {
  const sql = buildRawFileSql(splitStatements("begin; select ok(true); rollback;"));

  it("wraps in begin/rollback with a _tap_buf collector and a single final select", () => {
    expect(sql).toMatch(/^begin;/);
    expect(sql).toContain("create temp table if not exists _tap_buf");
    expect(sql).toContain("insert into _tap_buf(line) select ok(true)");
    expect(sql).toContain("select line from _tap_buf order by ord;");
    expect(sql.trimEnd()).toMatch(/rollback;$/);
  });

  it("refuses a COMMIT here too", () => {
    expect(() => buildRawFileSql(splitStatements("begin; commit; rollback;"))).toThrow(/COMMIT/);
  });
});

describe("buildChunkSql", () => {
  const entries = [
    {
      fnName: "pg_temp._prc_f0",
      file: "a.test.sql",
      statements: splitStatements("begin; select ok(true); rollback;"),
    },
    {
      fnName: "pg_temp._prc_f1",
      file: "b.test.sql",
      statements: splitStatements("begin; select ok(true); rollback;"),
    },
  ];
  const sql = buildChunkSql(entries, "N");

  it("wraps the whole chunk in ONE begin/rollback with a _tap_out collector", () => {
    expect(sql).toMatch(/^begin;/);
    expect(sql).toContain("create temp table _tap_out");
    expect(sql.trimEnd()).toMatch(/rollback;$/);
  });

  it("surrounds each file's function call with nonce-scoped begin/end markers", () => {
    expect(sql).toContain(`${FILE_BEGIN}N:a.test.sql`);
    expect(sql).toContain(`${FILE_END}N:a.test.sql`);
    expect(sql).toContain(`${FILE_BEGIN}N:b.test.sql`);
    expect(sql).toContain(`${FILE_END}N:b.test.sql`);
  });

  it("collects each function's output and ends with one final select", () => {
    expect(sql).toContain("insert into _tap_out(line) select * from pg_temp._prc_f0()");
    expect(sql).toContain("select line from _tap_out order by ord");
  });

  it("escapes single quotes in a marker filename", () => {
    const s = buildChunkSql(
      [
        {
          fnName: "pg_temp._prc_f0",
          file: "o'brien.test.sql",
          statements: splitStatements("begin; select ok(true); rollback;"),
        },
      ],
      "N",
    );
    expect(s).toContain("o''brien.test.sql");
  });
});

describe("parseChunkRows", () => {
  const N = "N";
  const begin = (f: string) => `${FILE_BEGIN}${N}:${f}`;
  const end = (f: string) => `${FILE_END}${N}:${f}`;

  it("splits combined rows per file and counts ok / not ok", () => {
    const rows = [
      begin("a.test.sql"),
      "1..2",
      "ok 1 - x",
      "ok 2 - y",
      end("a.test.sql"),
      begin("b.test.sql"),
      "1..1",
      "not ok 1 - z",
      end("b.test.sql"),
    ];
    const parsed = parseChunkRows(rows, ["a.test.sql", "b.test.sql"], N);
    const a = parsed.find((p) => p.file === "a.test.sql")!;
    const b = parsed.find((p) => p.file === "b.test.sql")!;
    expect(a.assertions).toBe(2);
    expect(a.failures).toBe(0);
    expect(a.accounted).toBe(true);
    expect(a.errored).toBe(false);
    expect(b.assertions).toBe(1);
    expect(b.failures).toBe(1);
    expect(b.accounted).toBe(true);
  });

  it("flags a file that emitted an ERROR marker as errored", () => {
    const rows = [begin("a.test.sql"), `${BODY_ERROR}${N}:division by zero`, end("a.test.sql")];
    const a = parseChunkRows(rows, ["a.test.sql"], N)[0]!;
    expect(a.errored).toBe(true);
  });

  it("marks an expected file unaccounted when its markers are missing (chunk aborted)", () => {
    const rows = [begin("a.test.sql"), "1..1", "ok 1 - x", end("a.test.sql")];
    const parsed = parseChunkRows(rows, ["a.test.sql", "b.test.sql"], N);
    expect(parsed.find((p) => p.file === "a.test.sql")!.accounted).toBe(true);
    expect(parsed.find((p) => p.file === "b.test.sql")!.accounted).toBe(false);
  });

  it("treats a file with a begin but no end marker as unaccounted (interrupted)", () => {
    const rows = [begin("a.test.sql"), "1..1", "ok 1 - x"];
    const a = parseChunkRows(rows, ["a.test.sql"], N)[0]!;
    expect(a.accounted).toBe(false);
  });

  it("counts a multi-line 'not ok' row (embedded newline diagnostic) as one failure", () => {
    const rows = [
      begin("a.test.sql"),
      "1..1",
      'not ok 1 - z\n# Failed test 1: "z"',
      end("a.test.sql"),
    ];
    const a = parseChunkRows(rows, ["a.test.sql"], N)[0]!;
    expect(a.assertions).toBe(1);
    expect(a.failures).toBe(1);
  });

  it("ignores a marker with the WRONG nonce — a test cannot forge a boundary", () => {
    const rows = [
      begin("a.test.sql"),
      "ok 1 - real",
      `${FILE_BEGIN}WRONG:b.test.sql`, // spoof attempt: right shape, wrong nonce
      "not ok 2 - still counted for a",
      end("a.test.sql"),
      begin("b.test.sql"),
      "ok 1 - b real",
      end("b.test.sql"),
    ];
    const parsed = parseChunkRows(rows, ["a.test.sql", "b.test.sql"], N);
    const a = parsed.find((p) => p.file === "a.test.sql")!;
    const b = parsed.find((p) => p.file === "b.test.sql")!;
    expect(a.assertions).toBe(2);
    expect(a.failures).toBe(1);
    expect(b.assertions).toBe(1);
    expect(b.failures).toBe(0);
  });

  it("ignores a correctly-nonced marker for a file not in this chunk", () => {
    const rows = [
      begin("a.test.sql"),
      "ok 1 - x",
      begin("ghost.test.sql"),
      "ok 2 - x",
      end("a.test.sql"),
    ];
    const parsed = parseChunkRows(rows, ["a.test.sql"], N);
    expect(parsed.find((p) => p.file === "a.test.sql")!.assertions).toBe(2);
    expect(parsed.some((p) => p.file === "ghost.test.sql")).toBe(false);
  });
});
