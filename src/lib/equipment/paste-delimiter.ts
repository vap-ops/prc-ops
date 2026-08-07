// Spec 367 §13 — the delimiter sniff, hoisted so the two equipment pastes share
// ONE rule instead of two copies that can drift.
//
// A Google-Sheets selection pastes TAB-delimited with no file round trip — the
// path that avoids a download entirely on the operator's cloud PC — while a
// downloaded CSV pastes comma-delimited. Sniffing the FIRST line is enough:
// every header row in both contracts is single-line and neither header contains
// a tab as data.

export function detectPasteDelimiter(text: string): "\t" | "," {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes("\t") ? "\t" : ",";
}
