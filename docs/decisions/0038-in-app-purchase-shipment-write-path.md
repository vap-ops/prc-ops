# ADR 0038 — In-app purchase/shipment write path + suppliers master

**Status:** Accepted — 2026-06-11. Spec 33. Amends ADR 0025 (AppSheet is
no longer the sole fact writer) and ADR 0026 Decision A (eta is no
longer AppSheet-only). Parallel-path posture per the ADR 0034
amendment: AppSheet's write path is untouched; both writers are legal
and the audit principal measures which one wins.

## Context

The only purchase-request facts without an in-app write path are the
purchase set (`supplier, order_ref, amount, purchased_at, eta`) and
`shipped_at` — AppSheet monopolizes them, so an AppSheet
misconfiguration blocks all purchase/shipment recording (three column
TODOs are open right now and break saves). ADR 0025's derive trigger,
the fact-transition audit triggers, and the spec-32 notification
capture triggers are all writer-agnostic — a second writer needs zero
trigger work. Suppliers were already queued as the seed of spend
analytics.

## Decision

### Suppliers master (`public.suppliers`)

Mirrors contractors (ADR 0033): `id`, `name` (non-blank CHECK),
`phone NULL`, `created_by` pin, `created_at`. Plain mutable master
data; **no DELETE** policy or grant — a supplier that sold something
stays referencable. Read: all staff (`site_admin, project_manager,
procurement, super_admin`). Write (INSERT/UPDATE): `project_manager,
procurement, super_admin` — NOT site_admin: purchase facts are
financial back-office data, unlike crew records. (The spec-31 lesson —
too-narrow gates lock the operator out — is noted; the operator runs
super_admin, and widening is a one-policy migration if field reality
disagrees.)

### `purchase_requests.supplier_id uuid NULL → suppliers`

The authoritative link for future spend analytics. The existing
`supplier text` column stays and is written as a **name snapshot** by
the RPC — display code and AppSheet continuity unchanged; AppSheet
keeps writing only the text column (no new grants — ADR 0034 freeze).

### Write mechanism — two SECURITY DEFINER RPCs

`set_work_package_contractor` precedent (ADR 0033): widening the PR
UPDATE policy would hand the role every column; RLS `WITH CHECK`
cannot restrict columns. The RPCs write exactly the fact set, with the
role gate, stage guard, and input checks inside (ADR 0011 hygiene:
`search_path` pinned, revoke-then-grant EXECUTE):

- `record_purchase(p_purchase_request_id, p_supplier_id, p_order_ref,
p_amount, p_eta)` — requires status `approved` AND `purchased_at IS
NULL`; resolves the supplier name (snapshot) or raises; rejects
  non-positive amounts and over-long order refs; sets
  `purchased_at = now()`.
- `record_shipment(p_purchase_request_id)` — requires status
  `purchased` AND `shipped_at IS NULL`; sets `shipped_at = now()`.

Role gate for both: `procurement | project_manager | super_admin`.
Status flips, audit rows, and notification outbox rows all come from
the EXISTING triggers (derive → `purchased`/`on_route`; fact audit;
spec-32 `pr_progress` capture) — this ADR adds no trigger.

### UI

`/requests` cards, visible to the gated roles only: a
บันทึกการสั่งซื้อ details-expander on `approved` cards (supplier
select + inline เพิ่มผู้ขายใหม่ create-and-pick, contractor-picker
pattern; order_ref / amount / eta inputs) and a บันทึกว่าจัดส่งแล้ว
confirm action on `purchased` cards.

## Rejected

- **Column-level GRANT + RLS policy** — viable (profile-management
  analysis, mechanism a) but diverges from the established RPC
  precedent and spreads the gate across two layers; the RPC keeps
  stage guard + role gate + column set in one reviewed body.
- **Replacing `supplier text` with the FK** — breaks AppSheet (frozen
  config) and the report/card display for historical rows; snapshot +
  FK costs one column.
- **Auto-demoting AppSheet on ship** — explicitly out per the ADR 0034
  amendment.

## Consequences (incl. in-build amendments from the adversarial review)

- **Coalesce semantics:** `record_purchase` sets optional facts only
  when provided — recording must never erase an AppSheet-pre-set value
  (an eta wipe would be audit-invisible: the purchase audit payload
  carries no eta and the correction branch is skipped on transition).
  Clearing a recorded fact = the corrections seam.
- **Column-scoped privileges:** authenticated's table-level
  INSERT/UPDATE on purchase_requests is revoked and re-granted with
  explicit column lists (exactly the create/decide/cancel sets). The
  back-office fact columns are writable only via the RPCs and
  appsheet_writer — the privilege layer now enforces what RLS cannot.
- **Read-freeze clarification:** ADR 0034's column freeze is a WRITE
  freeze — appsheet_writer's table-level SELECT does cover the new
  `supplier_id` column (harmless: a uuid for a name it already reads).
- **Procurement page access deferred:** `/requests` requireRole still
  excludes `procurement`; the role cannot reach the form until its own
  onboarding spec (requireRole + roleHome + tab set). PM/super_admin
  are the live audience today.

- `eta` becomes dual-writer (app at purchase time, AppSheet
  corrections). Field corrections after recording remain AppSheet-only
  for now — recorded seam (future in-app correction unit would need an
  audited correction RPC).
- AppSheet-written rows have `supplier_id IS NULL` — analytics must
  tolerate it; backfill-by-name is possible later.
- Audit principal for app-path fact writes is `authenticator`
  (ADR 0030 precedent), distinguishing them from `appsheet_writer`
  rows — the atrophy-model measurement comes free.
