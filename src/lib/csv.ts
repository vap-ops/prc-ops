// The one hardened CSV cell writer.
//
// This module exists because four copies of the same helper had already grown in
// the codebase (`labor/payroll.ts`, `accounting/journal-export.ts`,
// `purchase-report-view.ts`, `muster/attendance-csv.ts`), only the last of them
// carrying the formula-injection guard — a divergence the progress tracker
// recorded as needing "ONE shared hardened src/lib/csv.ts". Spec 367 U2 needed a
// hardened writer for two NEW exports, and adding a fifth copy would have made
// the problem worse, so the shared home is created here.
//
// ⚠️ Scope: the three older exports are deliberately NOT retrofitted in this
// unit. Swapping them to this import is a one-line change each but touches files
// spec 367 does not own, and each needs its own verification that no downstream
// consumer depends on the current (unguarded) output. That remains its own unit.

/**
 * RFC 4180 quoting plus a formula-injection defence.
 *
 * Excel and Google Sheets evaluate a cell beginning with `=`, `+`, `-`, `@`, tab
 * or CR as a formula. Every export in this app carries operator-editable free
 * text (equipment names, supplier names, worker names, descriptions), so an
 * unguarded cell means a spreadsheet can execute content the app merely stored.
 * Prefixing an apostrophe forces the cell to be read as literal text.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/**
 * A number for a spreadsheet cell — or BLANK when the value is unknown.
 *
 * Never renders a missing figure as `0`. In spec 367's transfer schedule 0/64
 * items currently carry a cost, and a fake `0.00` would price an asset at
 * nothing rather than saying "not captured" (the purchase-line-export rule).
 */
export function csvNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Join header + rows into a finished CSV body, prefixed with a UTF-8 BOM.
 *
 * The BOM is what makes Excel render Thai instead of mojibake — this app's
 * exports are opened by accounting and procurement on Windows, and without it
 * every Thai column is unreadable.
 */
export function toCsvBody(header: readonly string[], rows: readonly string[]): string {
  return "﻿" + [header.join(","), ...rows].join("\n") + "\n";
}

/** `equipment` + `2026-07-27` → `equipment-20260727.csv`, so files sort by date. */
export function csvFilename(prefix: string, isoDate: string): string {
  return `${prefix}-${isoDate.replaceAll("-", "")}.csv`;
}
