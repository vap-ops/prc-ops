# Spec 22 — Order tracking progress per request (with on_route stage)

**Origin:** operator chat 2026-06-11 — "each request having order tracking
progress is intuitive, design and implement" + "add on-route as well"
(operator explicitly chose a REAL `on_route` status over an ETA-derived
display stage).

## Part A — `on_route` lifecycle stage (DB)

Lifecycle becomes:
`requested → approved → purchased → on_route → delivered` (rejected =
terminal branch off requested; on_route is skippable — purchased →
delivered stays legal, AppSheet back offices won't always record a
shipment moment).

Per ADR 0025, AppSheet cannot write `status`; status is derived from fact
columns by `purchase_requests_derive_appsheet_status()`. Therefore:

1. Migration 1: `alter type purchase_request_status add value 'on_route'
after 'purchased'` (own file — a new enum value is unusable inside the
   transaction that adds it).
2. Migration 2:
   - `shipped_at timestamptz null` column on `purchase_requests`.
   - `grant update (shipped_at)` to `appsheet_writer` (9th granted column).
   - Derive-trigger function replaced: - guard: `shipped_at` null→non-null requires `old.status = 'purchased'`. - guard: `delivered_at` null→non-null requires `old.status in
('purchased','on_route')` (was `= 'purchased'`). - transition: `purchased` + shipped_at null→non-null ⇒ `on_route`. - transition: (`purchased`|`on_route`) + delivered_at null→non-null ⇒
     `delivered`.
   - Audit function + trigger (ADR 0026 shape):
     - new transition arm `purchased → on_route` audited as action
       `'update'` with payload `{principal, shipped_at, transition}` — no
       new audit_action enum value (decision recorded in ADR 0027).
     - `on_route → delivered` reuses the existing
       `purchase_request_delivery` case.
     - `shipped_at` joins the case-3 correction diff and the WHEN clause;
       correction arm's status list gains `'on_route'`.
3. pgTAP: new test file covers enum value present, purchased→on_route
   derivation, on_route→delivered, delivered-from-purchased still legal,
   shipped_at on a non-purchased row raises P0001.
4. ADR 0027 records the decision (real status vs derived display; no new
   audit action).

**Operator follow-ups (out of repo reach):**

- AppSheet column config: expose shipped_at as editable for procurement;
  re-run Tier-2 smoke ritual (role-touching migration).
- `pnpm db:types` regeneration happens post-push (agent does this).

## Part B — Tracker UI

New presentational component
`src/components/features/purchase-request-tracker.tsx` (server-safe, no
'use client'):

- Props: `status`, `requestedAt`, `decidedAt`, `purchasedAt`, `shippedAt`,
  `deliveredAt`, `eta` (strings/null straight off the row).
- Renders 5 steps: ส่งคำขอ → อนุมัติ → สั่งซื้อ → กำลังจัดส่ง → ได้รับของ
  (labels via a tracker-local map; list-pill labels in
  `PURCHASE_REQUEST_STATUS_LABEL` gain `on_route: "กำลังจัดส่ง"`).
- Step states: done (emerald dot + date beneath, Thai short date), current
  (blue ring, bold), future (zinc outline). Connector line filled up to
  the current step.
- `rejected`: step 2 renders red "ไม่อนุมัติ" terminal, steps 3–5 muted.
- on_route skipped (delivered with shipped_at null): the จัดส่ง step shows
  as done-with-no-date (dash) — pipeline never lies about order.
- ETA: under the ได้รับของ step while undelivered and `eta` set
  (คาดว่า + Thai date).
- Mounted in every `/requests` card between the header row and the detail
  lines. Status pill stays (color語 at a glance); the scattered
  per-status date lines REMAIN (they carry supplier/receiver detail the
  stepper doesn't).
- `status-colors.ts`: `on_route` pill = sky/blue family solid fill (spec
  20 sun palette contrast rules).

## Out of scope

AppSheet app changes (operator), notifications, requester-visible
courier/tracking-number fields (future spec if wanted).

## Verification checklist

- [ ] pgTAP suite green post-push (`pnpm db:test`).
- [ ] Unit tests: tracker render states incl. rejected + skipped on_route.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] 375px preview: stepper fits the card, no overflow.
