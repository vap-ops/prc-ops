// Bug fix, 2026-08-08 — `decide_identity_change`'s approve arm writes the
// proposed national ID into `workers.tax_id`, which carries the firm-wide
// unique index `workers_tax_id_unique` (spec 279 U1, partial on NOT NULL).
// A collision (the ID already belongs to another worker row) raised `23505`
// and fell through to the generic transient copy — "ลองใหม่อีกครั้ง" — which
// is a lie: the same proposal will always collide. Same defect class as the
// `/workers` roster incident (src/app/workers/error-copy.ts).
//
// The reader here is the APPROVER looking at someone else's stored proposal,
// not the submitter, so this returns the FACT only — mirrors dob-refusal.ts's
// split (each call site appends its own next step).
//
// A leaf module with no `server-only` and no DB import, so the "use server"
// actions file (which may only export async functions) can hold it.

export function identityDuplicateTaxIdFact(
  error: { code?: string; message?: string } | null,
): string | null {
  if (error?.code !== "23505") return null;
  if (!error.message?.includes("workers_tax_id_unique")) return null;
  return "เลขบัตรใหม่นี้มีอยู่แล้วในระบบสำหรับพนักงานคนอื่น";
}
