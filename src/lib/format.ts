// Money formatting — the single source of truth (architecture-quality audit
// rank 1 + rank 9). Every baht/round2 formatter lives here; nothing re-rolls a
// local copy (the `tests/unit/format.test.ts` guard enforces it). A future
// precision or locale change is therefore a one-file edit, not the 30-file
// shotgun surgery this consolidation replaced.
//
// Pure and isomorphic — only `toLocaleString` + `Math`, no imports — so it is
// safe in both Server and Client Components. Grouping is pinned to th-TH; for
// baht amounts th-TH and en-US produce identical comma grouping, so the four
// historical idioms collapse to one locale with no visible change.
//
// Pick by presentation, not by surface:
//   baht           "1,234.50"      bare body, 2dp — caller adds its own unit
//   bahtWithSymbol  "฿1,234.50"     ฿ prefix, 2dp, sign before the symbol
//   bahtCompact     "฿1,235"        ฿ prefix, rounded to whole baht — spend chips
//   bahtUnit        "1,234.5 บาท"   trailing บาท unit, up to 2dp
//   round2          number         2dp numeric rounding for money compares

const TWO_DP = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const UP_TO_TWO_DP = { maximumFractionDigits: 2 } as const;

/** Thai-grouped, always 2dp, no symbol. Prefix ฿ or add a unit at the call site. */
export function baht(n: number): string {
  return n.toLocaleString("th-TH", TWO_DP);
}

/** ฿ prefix, always 2dp, with the minus before the symbol (-฿240.00, not ฿-240.00). */
export function bahtWithSymbol(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}฿${Math.abs(n).toLocaleString("th-TH", TWO_DP)}`;
}

/** ฿ prefix, rounded to whole baht — compact spend/summary chips. */
export function bahtCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}฿${Math.round(Math.abs(n)).toLocaleString("th-TH")}`;
}

/** Trailing " บาท" unit, up to 2dp (no forced trailing zeros). */
export function bahtUnit(n: number): string {
  return `${n.toLocaleString("th-TH", UP_TO_TWO_DP)} บาท`;
}

/** Round to 2 decimals as a number — kills float noise in money compares. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
