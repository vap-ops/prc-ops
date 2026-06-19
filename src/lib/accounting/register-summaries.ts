// Spec 149 U9b — pure summaries for the /accounting registers. Totals the
// withheld retention by status; `open` (held + due) is the amount still owed to
// us by clients. Unknown statuses are ignored (forward-compatible).

export interface RetentionSummaryRow {
  status: string;
  amountWithheld: number;
}

export interface RetentionSummary {
  held: number;
  due: number;
  released: number;
  forfeited: number;
  open: number;
}

export function summarizeRetention(rows: RetentionSummaryRow[]): RetentionSummary {
  const s: RetentionSummary = { held: 0, due: 0, released: 0, forfeited: 0, open: 0 };
  for (const r of rows) {
    if (r.status === "held") s.held += r.amountWithheld;
    else if (r.status === "due") s.due += r.amountWithheld;
    else if (r.status === "released") s.released += r.amountWithheld;
    else if (r.status === "forfeited") s.forfeited += r.amountWithheld;
  }
  s.open = s.held + s.due;
  return s;
}
