// Spec 386 U5 — can we actually reach this person? The ROSTER counterpart to
// readiness.ts, which answers the same question for the signed-in user alone.
//
// Operator, 2026-07-31: "where do I track the status who is onboarding to this
// feature?" — there was no answer. The fill rate (`count(telegram_chat_id)`) is
// the acceptance number for spec 386, but a number is not a chase list; this
// turns it into one, per person.
//
// ⭐ The load-bearing distinction is UNKNOWN vs UNREACHABLE. `line_oa_friend` is
// refreshed only at LINE login (spec 318 U1), so `null` means "never probed",
// NOT "not a friend". Measured 2026-07-31: 9 of the 17 office-tier users sit at
// null. Rendering those as a red ✗ would send the operator chasing people who
// may already be reachable — so `unknown` is its own arm, everywhere.
//
// ⚠️ And this measures BINDING, not delivery. A Telegram-bound user still
// receives nothing until TELEGRAM_BOT_TOKEN is set in the deploy (spec 386 U0),
// which is why the page pairs this with an explicit "the bot is not configured"
// line rather than letting a green chip imply a delivered message.

export type Reachability = "telegram" | "line" | "unknown" | "none";

export interface ReachabilityRow {
  telegram_chat_id: string | null;
  /** null = never probed (pre-318 login), NOT "not a friend". */
  line_oa_friend: boolean | null;
}

export interface ReachabilitySummary {
  total: number;
  telegram: number;
  line: number;
  unknown: number;
  none: number;
}

export function classifyReachability(row: ReachabilityRow): Reachability {
  // Telegram first: it is the channel that still works when the LINE OA quota is
  // blown, which is the whole reason spec 386 exists.
  if (row.telegram_chat_id !== null) return "telegram";
  if (row.line_oa_friend === true) return "line";
  // Deliberately NOT folded into `none` — see the header. A falsy check here
  // would be the bug this module was written to prevent.
  if (row.line_oa_friend === null) return "unknown";
  return "none";
}

export function summarizeReachability(rows: readonly ReachabilityRow[]): ReachabilitySummary {
  const summary: ReachabilitySummary = {
    total: rows.length,
    telegram: 0,
    line: 0,
    unknown: 0,
    none: 0,
  };
  for (const row of rows) summary[classifyReachability(row)] += 1;
  return summary;
}
