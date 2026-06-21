// Pure parse + validate for the work_packages importer. See ADR 0014 (CSV
// contract) and spec 163 (Google-Sheets paste).
//
// This module contains NO I/O — no file reads, no DB calls. The CLI script
// at scripts/import-wp.ts and the U7 import action both wrap it. The split is
// what makes every validation rule testable from crafted input strings.
//
// Two input shapes are accepted, auto-detected (spec 163):
//   1. Hand-written CSV: comma-delimited, with a `code,name,description`
//      header row (the original ADR 0014 contract).
//   2. Google-Sheets cell paste: TAB-delimited, NO header, positional columns
//      (col 1 = code, col 2 = name, col 3 = description).
// Detection: a TAB anywhere → tab delimiter, else comma; a first cell of
// `code` (case-insensitive) → header row, else positional with no header.

import Papa from "papaparse";

export interface WpRow {
  code: string;
  name: string;
  description: string | null;
}

export interface ParseAndValidateResult {
  rows: WpRow[];
  errors: string[];
}

// Normalised row before validation: values may be missing (undefined) whether
// they came from a named header column or a positional cell.
interface RawRow {
  code: string | undefined;
  name: string | undefined;
  description: string | undefined;
}

function detectDelimiter(text: string): "\t" | "," {
  return text.includes("\t") ? "\t" : ",";
}

// True when the first non-empty line is a header row (its first cell is the
// literal `code`). A leading BOM and surrounding whitespace are tolerated.
function hasHeaderRow(text: string, delimiter: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    // .trim() strips a leading BOM too (U+FEFF is ECMAScript whitespace).
    const firstCell = (line.split(delimiter)[0] ?? "").trim().toLowerCase();
    return firstCell === "code";
  }
  return false;
}

// `existingCodes` is the set of code values currently in the DB for the target
// project. The caller fetches it; this function does not touch the DB.
//
// Row numbers in error messages are 1-based DATA-row indices: row 1 is the
// first data row (the row after the header in header mode, or the first line
// in header-less mode). Empty rows are skipped (papaparse skipEmptyLines), so
// row numbering is over the non-empty data rows only.
export function parseAndValidate(
  csvText: string,
  existingCodes: ReadonlySet<string>,
): ParseAndValidateResult {
  const errors: string[] = [];
  const rows: WpRow[] = [];
  const seenInFile = new Set<string>();

  const delimiter = detectDelimiter(csvText);
  const header = hasHeaderRow(csvText, delimiter);

  let records: RawRow[];
  let parseErrors: Papa.ParseError[];

  if (header) {
    const parsed = Papa.parse<Record<string, string | undefined>>(csvText, {
      header: true,
      delimiter,
      skipEmptyLines: true,
    });
    parseErrors = parsed.errors;
    records = parsed.data.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
    }));
  } else {
    const parsed = Papa.parse<string[]>(csvText, {
      header: false,
      delimiter,
      skipEmptyLines: true,
    });
    parseErrors = parsed.errors;
    records = parsed.data.map((cols) => ({
      code: cols[0],
      name: cols[1],
      description: cols[2],
    }));
  }

  // Field-count mismatches happen when a row has more or fewer values than the
  // header has columns. Extra columns are ignored by contract and missing
  // trailing values become empty strings the per-field checks below catch — so
  // these papaparse warnings are not validation errors.
  for (const e of parseErrors) {
    if (e.code === "TooManyFields" || e.code === "TooFewFields") continue;
    const rowNum = typeof e.row === "number" ? e.row + 1 : "?";
    errors.push(`Row ${rowNum}: parse error — ${e.message}`);
  }

  records.forEach((raw, i) => {
    const rowNum = i + 1;
    const code = (raw.code ?? "").trim();
    const name = (raw.name ?? "").trim();
    const description = (raw.description ?? "").trim();

    let rowOk = true;
    if (!code) {
      errors.push(`Row ${rowNum}: code is required (blank or missing)`);
      rowOk = false;
    }
    if (!name) {
      errors.push(`Row ${rowNum}: name is required (blank or missing)`);
      rowOk = false;
    }
    if (code && seenInFile.has(code)) {
      errors.push(`Row ${rowNum}: duplicate code "${code}" within the file`);
      rowOk = false;
    } else if (code && existingCodes.has(code)) {
      errors.push(`Row ${rowNum}: code "${code}" already exists for this project`);
      rowOk = false;
    }

    if (rowOk) {
      seenInFile.add(code);
      rows.push({
        code,
        name,
        description: description.length > 0 ? description : null,
      });
    }
  });

  return { rows, errors };
}
