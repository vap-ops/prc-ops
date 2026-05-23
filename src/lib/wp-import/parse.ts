// Pure parse + validate for the work_packages CSV importer. See ADR 0014.
//
// This module contains NO I/O — no file reads, no DB calls. The CLI script
// at scripts/import-wp.ts wraps it with I/O. The split is what makes every
// validation rule testable from crafted CSV strings.

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

// `existingCodes` is the set of (project_id, code) → code values currently
// in the DB for the target project. The caller fetches it via the admin
// client; this function does not touch the DB.
//
// Row numbers in error messages are 1-based DATA-row indices: row 1 is the
// first row after the header. Empty rows are skipped (papaparse
// skipEmptyLines), so row numbering is over the non-empty data rows only.
export function parseAndValidate(
  csvText: string,
  existingCodes: ReadonlySet<string>,
): ParseAndValidateResult {
  const errors: string[] = [];
  const rows: WpRow[] = [];
  const seenInFile = new Set<string>();

  const parsed = Papa.parse<Record<string, string | undefined>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  // Field-count mismatches happen when a row has more or fewer values than
  // the header has columns. Extra columns are ignored by contract (we read
  // by header name), and missing trailing values become empty strings that
  // the per-field checks below will catch — so these papaparse warnings are
  // not validation errors.
  for (const e of parsed.errors) {
    if (e.code === "TooManyFields" || e.code === "TooFewFields") continue;
    const rowNum = typeof e.row === "number" ? e.row + 1 : "?";
    errors.push(`Row ${rowNum}: parse error — ${e.message}`);
  }

  parsed.data.forEach((raw, i) => {
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
