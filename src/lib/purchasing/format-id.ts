// Spec 211 U2 — SSOT for rendering the human PO / PR running numbers. Both are
// zero-padded to 4 (PO-0012, PR-0007) so the SAME id never renders two ways: the
// worklist grid showed a bare "PR-7" while the drawer/detail showed "PR-0007".
// null/undefined → 0, mirroring the notification formatter (compose-notification.ts).
// Pure (no React / no DB) → unit-tested.

export function formatPoNumber(poNumber: number | null | undefined): string {
  return `PO-${String(poNumber ?? 0).padStart(4, "0")}`;
}

export function formatPrNumber(prNumber: number | null | undefined): string {
  return `PR-${String(prNumber ?? 0).padStart(4, "0")}`;
}
