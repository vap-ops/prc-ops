// Spec 211 (cross-engine reconcile) — the band terms SHARED by the two worklist
// engines: the site view (request-bands.ts, for site_admin / project_manager /
// super_admin) and the procurement pipeline (procurement-pipeline.ts, for
// procurement). Each role sees only ONE engine, so there is no same-screen
// contradiction (that was U7); but the same purchase-request state is banded by
// both, and the terms they genuinely share were duplicated literals — a drift
// risk (audit critic gap X2: "two band engines over one table"). Single-source
// them here so a rename touches ONE place (the ui-term-consistency-ssot doctrine).
//
// What is NOT here: bands that read DIFFERENTLY per role-view, on purpose —
//   • site `to_order` = "อนุมัติแล้ว " + the shared `to_order` core (the requester
//     wants to know it was approved); procurement uses the bare core.
//   • the terminal band: site frames it `done`="เสร็จแล้ว" / `closed` (the
//     requester's lifecycle); procurement frames it `received`="ได้รับแล้ว" (the
//     buyer's). Both are audience-correct and stay distinct — see each engine.
export const WORKLIST_BAND_TERM = {
  awaiting_approval: "รออนุมัติ",
  to_order: "รอสั่งซื้อ",
  in_transit: "กำลังจัดส่ง",
} as const;
