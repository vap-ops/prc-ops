// Spec 100 — dashboard operational rollup. Pure + money-free, so every staff
// role can use it (the budget/spend half lives in ./spend, PM/super only).

export interface ProjectProgress {
  total: number;
  complete: number;
  /** 0..100, rounded; 0 when there are no work packages. */
  pctComplete: number;
  /** WPs that need a human: on_hold or pending_approval. */
  needsAttention: number;
}

const ATTENTION = new Set(["on_hold", "pending_approval"]);

export function rollupProgress(wps: ReadonlyArray<{ status: string }>): ProjectProgress {
  const total = wps.length;
  const complete = wps.filter((w) => w.status === "complete").length;
  const needsAttention = wps.filter((w) => ATTENTION.has(w.status)).length;
  const pctComplete = total === 0 ? 0 : Math.round((complete / total) * 100);
  return { total, complete, pctComplete, needsAttention };
}
