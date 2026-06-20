// Spec 161 U13 — the Nova economy snapshot, derived from the coin ledger (never a
// stored aggregate). issued = Σ positive postings; returned = Σ |negative| (shop
// spends + confiscations); outstanding = the live liability (issued − returned);
// holders = workers with a positive net balance; bySource = net per coin_source.
// Pure + tested so the operator console just renders it. Amounts may be strings.

type LedgerRow = { worker_id: string; source: string; amount: number | string };

export interface EconomySummary {
  issued: number;
  returned: number;
  outstanding: number;
  holders: number;
  bySource: Record<string, number>;
}

export function summarizeLedger(postings: LedgerRow[]): EconomySummary {
  let issued = 0;
  let returned = 0;
  const bySource: Record<string, number> = {};
  const netByWorker = new Map<string, number>();

  for (const p of postings) {
    const n = Number(p.amount);
    if (n > 0) issued += n;
    else returned += -n;
    bySource[p.source] = (bySource[p.source] ?? 0) + n;
    netByWorker.set(p.worker_id, (netByWorker.get(p.worker_id) ?? 0) + n);
  }

  let holders = 0;
  for (const net of netByWorker.values()) if (net > 0) holders += 1;

  return { issued, returned, outstanding: issued - returned, holders, bySource };
}
