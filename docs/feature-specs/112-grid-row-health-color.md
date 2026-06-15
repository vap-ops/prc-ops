# Spec 112 — Band-relative row health color in the procurement grid

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user tablet/PC).
**Driver:** operator on grid coloring — "coloring urgent red doesn't help if they already ordered
the things." Right: request priority is the _requester's_ lens; once the buyer has ordered, urgency
is stale. So color the grid by the **buyer's time pressure**, not the priority flag —
**band-relative**, where red _means_ a different thing per band:

- **รอสั่งซื้อ (to_order, not yet ordered):** `needed_by` vs today. Past due, not ordered → 🔴;
  due within the soon-window → 🟡; otherwise 🟢. (Here "urgent" still matters — nothing's ordered.)
- **กำลังจัดส่ง (in_transit, already ordered):** the request's urgency is moot — will it arrive in
  time? ETA past today → 🔴 (chase); ETA later than `needed_by` → 🟡 (will land late); else 🟢.
- **ได้รับแล้ว (received):** 🟢 done.
- **รออนุมัติ (awaiting_approval):** ⚪ not the buyer's move (waiting on PM).

The band already says the action; the mini-bar (spec 111) says the stage; **this color says whether
it's on time.** Three orthogonal signals, no noise.

## What ships (app-only, no schema/migration)

- **`src/lib/purchasing/row-health.ts`** (NEW, pure) — `rowHealth(status, eta, neededBy, todayIso)`
  → `late | at_risk | on_track | waiting`, band-aware per the rules above (`HEALTH_SOON_DAYS = 7`;
  date math via a `daysUntil` ISO-date diff). Plus `rowHealthLabel(h)` Thai (hover title).
- **`src/components/features/procurement-grid.tsx`** — each row's first cell gets a `border-l-4`
  health color (late=danger, at_risk=attn, on_track=done-strong, waiting=edge) + a `title` naming
  the reason; the ETA turns `text-danger` when an in-transit row's ETA is past due. Grid only —
  the band header, the mini-bar, the pill, the phone cards are unchanged.
- **`src/app/requests/page.tsx`** — passes `today` (`bangkokTodayISO()`, already computed) into
  `<ProcurementGrid>` so the health math uses the Bangkok civil date, not the client clock.

## Tests

- **TDD:** `tests/unit/row-health.test.ts` first (RED) — requested→waiting; to_order past/soon/far/
  no-need; in_transit overdue/late-vs-need/on-time/no-eta; received→on_track; rejected/cancelled→
  waiting; the soon-window boundary.
- The grid color/title is presentational over the tested helper → checklist.

## Acceptance

Procurement user on a PC: a row not-yet-ordered past its needed_by glows red; a shipment past its
ETA glows red; a shipment that'll land after needed_by glows amber; on-track rows green; awaiting-
approval rows neutral. Hovering a row explains why. The pill / mini-bar / cards are unchanged.

## Seams (recorded)

- `HEALTH_SOON_DAYS = 7` is a fixed window (no per-project SLA yet).
- received → 🟡 when the invoice/doc is missing (the filing gap) needs an attachment-presence query
  — deferred (spec-104 seam).
- A color legend + applying the health color to the phone cards are later steps (grid-first).
- in_transit with no ETA reads on_track (not flagged) — an "unmanaged PO (no ETA)" amber is a later
  refinement.
