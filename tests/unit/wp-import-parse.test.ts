import { describe, it, expect } from "vitest";

import { parseAndValidate } from "@/lib/wp-import/parse";

// These tests cover the pure parse + validate logic for the work_packages
// CSV importer (ADR 0014). The function takes a CSV string + the set of
// codes already in the DB for the target project, and returns rows + a
// list of errors. No I/O — no DB, no filesystem.

const NO_EXISTING = new Set<string>();

describe("parseAndValidate — happy path", () => {
  it("parses valid rows with no errors", () => {
    const csv =
      "code,name,description\n" +
      "WP-001,Foundation excavation,Excavate to 2.5m depth\n" +
      "WP-002,Reinforcement cage,Steel rebar binding for columns\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        code: "WP-001",
        name: "Foundation excavation",
        description: "Excavate to 2.5m depth",
      },
      {
        code: "WP-002",
        name: "Reinforcement cage",
        description: "Steel rebar binding for columns",
      },
    ]);
  });

  it("treats blank description as NULL (optional column)", () => {
    const csv = "code,name,description\n" + "WP-001,Foundation excavation,\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "WP-001", name: "Foundation excavation", description: null }]);
  });

  it("treats a missing description column as NULL (optional column)", () => {
    // description column is absent entirely — only code + name in the file.
    const csv = "code,name\n" + "WP-001,Foundation excavation\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "WP-001", name: "Foundation excavation", description: null }]);
  });

  it("trims whitespace around values", () => {
    const csv = "code,name,description\n" + "  WP-001 ,  Padded name  ,  desc with pad  \n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "WP-001", name: "Padded name", description: "desc with pad" }]);
  });

  it("returns empty rows and no errors for a header-only file", () => {
    const csv = "code,name,description\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([]);
  });
});

describe("parseAndValidate — validation rules", () => {
  it("reports a missing code with the row number", () => {
    const csv = "code,name,description\n" + ",Name without code,desc\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(rows).toEqual([]);
    expect(errors).toEqual(["Row 1: code is required (blank or missing)"]);
  });

  it("reports a missing name with the row number", () => {
    const csv = "code,name,description\n" + "WP-001,,desc\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(rows).toEqual([]);
    expect(errors).toEqual(["Row 1: name is required (blank or missing)"]);
  });

  it("reports a duplicate code within the file", () => {
    const csv =
      "code,name,description\n" +
      "WP-001,First,\n" +
      "WP-002,Second,\n" +
      "WP-001,Duplicate of first,\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    // First two rows are valid and accumulated; the third is rejected.
    expect(rows).toEqual([
      { code: "WP-001", name: "First", description: null },
      { code: "WP-002", name: "Second", description: null },
    ]);
    expect(errors).toEqual(['Row 3: duplicate code "WP-001" within the file']);
  });

  it("reports a code that already exists in the DB for this project", () => {
    const csv = "code,name,description\n" + "WP-NEW,Brand new,\n" + "WP-EXIST,Already in DB,\n";
    const existing = new Set(["WP-EXIST"]);
    const { rows, errors } = parseAndValidate(csv, existing);
    expect(rows).toEqual([{ code: "WP-NEW", name: "Brand new", description: null }]);
    expect(errors).toEqual(['Row 2: code "WP-EXIST" already exists for this project']);
  });

  it("collects multiple errors across rows in one run", () => {
    // Row 1 missing code; row 2 missing name; row 3 has a dup of nothing-yet
    // but its code already exists; row 4 is a valid row repeated as row 5.
    const csv =
      "code,name,description\n" +
      ",missing code,\n" +
      "WP-002,,missing name\n" +
      "WP-DB,Already in DB,\n" +
      "WP-004,Valid,\n" +
      "WP-004,Repeat of WP-004,\n";
    const existing = new Set(["WP-DB"]);
    const { rows, errors } = parseAndValidate(csv, existing);
    expect(rows).toEqual([{ code: "WP-004", name: "Valid", description: null }]);
    expect(errors).toEqual([
      "Row 1: code is required (blank or missing)",
      "Row 2: name is required (blank or missing)",
      'Row 3: code "WP-DB" already exists for this project',
      'Row 5: duplicate code "WP-004" within the file',
    ]);
  });
});

describe("parseAndValidate — papaparse robustness", () => {
  it("ignores unknown / extra columns gracefully", () => {
    // The richer source-sheet case: extra columns the v1 importer doesn't
    // know about (cost / subcon / qa) must be silently dropped.
    const csv =
      "code,name,description,cost,subcon,qa\n" +
      "WP-001,Foundation,Excavate,1200000,Acme Co,Pending\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "WP-001", name: "Foundation", description: "Excavate" }]);
  });

  it("parses quoted fields with embedded commas", () => {
    const csv =
      "code,name,description\n" +
      'WP-001,"Foundation, footings, and pile caps","Stage 1, with rebar"\n';
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        code: "WP-001",
        name: "Foundation, footings, and pile caps",
        description: "Stage 1, with rebar",
      },
    ]);
  });

  it("parses Thai characters in UTF-8 content", () => {
    const csv = "code,name,description\n" + "WP-T01,เสาเข็มเจาะ Ø 0.60 m,หล่อในที่\n";
    const { rows, errors } = parseAndValidate(csv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        code: "WP-T01",
        name: "เสาเข็มเจาะ Ø 0.60 m",
        description: "หล่อในที่",
      },
    ]);
  });
});

describe("parseAndValidate — Google Sheets paste (spec 163)", () => {
  it("parses a tab-delimited, header-less, two-column sheet paste", () => {
    // A Google-Sheets cell copy: TAB between columns, NO header row, the
    // example case is code + name only (no description).
    const tsv =
      "WP-001\tงานหาพิกัดและระดับพื้น\n" +
      "WP-002\tงานทำไฟฟ้าชั่วคราว\n" +
      "WP-003\tงานทำประปาชั่วคราว\n";
    const { rows, errors } = parseAndValidate(tsv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { code: "WP-001", name: "งานหาพิกัดและระดับพื้น", description: null },
      { code: "WP-002", name: "งานทำไฟฟ้าชั่วคราว", description: null },
      { code: "WP-003", name: "งานทำประปาชั่วคราว", description: null },
    ]);
  });

  it("reads a third tab column as description when present", () => {
    const tsv = "WP-001\tFoundation\tExcavate to 2.5m\n";
    const { rows, errors } = parseAndValidate(tsv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "WP-001", name: "Foundation", description: "Excavate to 2.5m" }]);
  });

  it("still honours a header row even when tab-delimited", () => {
    const tsv = "code\tname\tdescription\n" + "WP-001\tFoundation\tStage 1\n";
    const { rows, errors } = parseAndValidate(tsv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "WP-001", name: "Foundation", description: "Stage 1" }]);
  });

  it("validates the header-less paste with correct data-row numbers", () => {
    // Row 1 valid; row 2 missing name; row 3 dup of row 1's code.
    const tsv = "WP-001\tFirst\n" + "WP-002\t\n" + "WP-001\tDuplicate\n";
    const { rows, errors } = parseAndValidate(tsv, NO_EXISTING);
    expect(rows).toEqual([{ code: "WP-001", name: "First", description: null }]);
    expect(errors).toEqual([
      "Row 2: name is required (blank or missing)",
      'Row 3: duplicate code "WP-001" within the file',
    ]);
  });

  it("trims whitespace in a header-less tab paste", () => {
    const tsv = "  WP-001 \t  Padded name  \n";
    const { rows, errors } = parseAndValidate(tsv, NO_EXISTING);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ code: "WP-001", name: "Padded name", description: null }]);
  });
});
