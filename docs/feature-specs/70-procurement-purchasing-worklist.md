# Spec 70 — Procurement onboarding: the purchasing worklist

**Status:** COMPLETE (2026-06-13; migration APPLIED to prod, pgTAP 790/790; operator go/no-go = "Apply now").
**Depends on:** ADR 0013 (role-level access), ADR 0022/0026 (purchasing visibility), ADR 0038 (back-office record/ship RPCs), ADR 0043 (documents).
**Operator decision (2026-06-13):** "what next" → procurement chosen as the next unit; first cut = the **purchasing worklist (/requests)** (not PR triage, not supplier-master-first, not full PM parity).

## 1. Why

`procurement` is a v2 role (CLAUDE.md). Today it logs in and is bounced to `/coming-soon` —
no real surface. "Onboarding" = remove that redirect and give procurement its first real job:
the back-office purchasing worklist that PMs currently share at `/requests`.

The privilege groundwork is already half-built and **inconsistent**:

- `isBackOfficeRole()` (`src/lib/purchasing/back-office.ts`) **already declares procurement
  back-office** at the app layer — the record-purchase / record-shipment forms render for it.
- `record_purchase` / `record_shipment` SECURITY DEFINER RPCs **already gate procurement in**.
- `purchase_requests` SELECT (ADR 0026) and `suppliers` SELECT **already admit procurement**.

But three RLS policies never caught up to that doctrine:

| Policy                                | Admits procurement? | Effect if not                                                                                                  |
| ------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `work_packages` SELECT                | ❌                  | blank WP labels on the worklist (violates the WP-centric principle); no `project_id` ⇒ uploaders cannot render |
| `purchase_request_attachments` INSERT | ❌                  | procurement cannot file an invoice / delivery-confirmation row                                                 |
| storage `pr-attachments` INSERT       | ❌                  | upload blocked at the path layer                                                                               |

So procurement could _reach_ the worklist and record purchases/shipments, but would see a
list with no work-package identity and broken upload buttons. This unit **aligns the RLS layer
with the already-declared back-office role** so procurement is a coherent worklist participant.

## 2. Scope

### In — procurement on the purchasing worklist

1. **Routing.** `roleHome(procurement)` → `/requests` (was `/coming-soon`).
2. **Page gates.** A new canonical allowlist `PURCHASING_ROLES = [site_admin, project_manager,
super_admin, procurement]` admits procurement on `/requests` and `/requests/[requestId]`.
   (Do NOT add procurement to `SITE_STAFF_ROLES` — that set gates SA photo/WP screens procurement
   must not reach.)
3. **Bottom-tab nav.** `PROCUREMENT_TABS = [คำขอซื้อ → /requests, โปรไฟล์ → /profile]`. No โครงการ
   (procurement has no project/WP hub in v1 — `projects` SELECT stays deferred per spec 58), no
   รอตรวจ (not a decider).
4. **Create-request section hidden for procurement.** On `/requests`, the `สร้างคำขอซื้อ` section
   is withheld for procurement — it is a back-office _processor_, not a requester. (Procurement is
   not in the `purchase_requests` INSERT policy and has no WP link to arrive `?wp=`-pinned, so the
   section is inert for it; hiding it removes a dead/broken submit path and answers the operator's
   "how does procurement's view differ" question.)
5. **DB migration — procurement back-office RLS parity** (one logical change, three policies; each
   adds `'procurement'` to an existing role IN-list, name unchanged so `policies_are` pins stay
   green):
   - `work_packages` SELECT → `('site_admin','project_manager','procurement','super_admin')`.
     INSERT/UPDATE policies **untouched** (procurement reads WPs, never writes them).
   - `purchase_request_attachments` INSERT policy role gate → add `procurement` (the per-purpose
     arms — reference/delivery_confirmation/invoice — are unchanged; procurement inherits the
     delivery_confirmation + invoice arms, which is its job; the reference arm's own-parent +
     `status='requested'` predicate makes it inert for a non-requester).
   - storage `pr-attachments` INSERT policy role gate → add `procurement`.

### What procurement gets on the worklist

- See **all** purchase requests (existing RLS) **with WP code/name** (after the WP read widen).
- **Record purchase** (supplier dropdown works — `suppliers` SELECT already admits procurement)
  and **record shipment** (`isBackOfficeRole` ✅ + the RPCs ✅).
- **Upload invoice / receipt** (ใบส่งของ/ใบเสร็จ) and **delivery-confirmation photos** on the
  detail page (after the attachment + storage widen).

### Out — stays PM-only (worklist ≠ triage; operator call)

All of these are already `isDecider`-gated (`project_manager`/`super_admin`) and so already exclude
procurement — this unit must **not** widen them:

- Approve / reject a request (`PurchaseRequestDecision`).
- Cancel an approved request (`PurchaseRequestCancel`).
- Record an on-site cash purchase — lives on the **SA WP-detail** page, not `/requests`; procurement
  has no WP-detail surface.
- Acknowledge a site purchase (`SitePurchaseAcknowledge`).

### Out — deliberately deferred (recorded seams)

- `projects` SELECT for procurement (no project hub / project list in v1 — the WP→project link on the
  detail page uses `wp.project_id` already on the WP row; the link target gate (`SITE_STAFF_ROLES`)
  will bounce procurement, so the WP reference renders as **plain text** for procurement, not a link).
- Procurement creating purchase requests (it is not a requester in v1).
- A HubNav (desktop) entry / `/pm`-style hub for procurement — the bottom tabs are the v1 nav.
- Supplier-master management screen for procurement (it can already create suppliers inline via the
  record-purchase form; a dedicated screen is a later unit).

## 3. Design notes

- **WP reference, not WP link, for procurement.** On `/requests/[id]` the WP code/name currently
  renders as a `<Link>` to `/sa/projects/.../work-packages/...`. That route is `SITE_STAFF_ROLES`-gated
  and would bounce procurement. Render the WP code/name as plain text when `ctx.role === 'procurement'`
  (keep the link for sa/pm/super). Same on the list card if it links the WP (verify; the slim
  `PurchaseRequestCard` links the whole card to `/requests/[id]`, not the WP — so likely no card change).
- **No new enum, no new table, no new column.** Pure policy widening + routing/nav.
- **appsheet_writer untouched.** `current_user_role()` returns NULL for that DB role; none of the
  widened policies admit it (it has its own `TO appsheet_writer` policies).

## 4. Files

App:

- `src/lib/auth/role-home.ts` — `roleHome(procurement)` → `/requests`; export `PURCHASING_ROLES`.
- `src/app/requests/page.tsx` — gate `requireRole(PURCHASING_ROLES)`; hide the create-request section
  for procurement.
- `src/app/requests/[requestId]/page.tsx` — gate `requireRole(PURCHASING_ROLES)`; WP reference as
  plain text for procurement.
- `src/components/features/bottom-tab-bar.tsx` — `PROCUREMENT_TABS`; `tabsForRole` procurement branch.

DB:

- `supabase/migrations/2026062400xx00_procurement_back_office_rls.sql` — the three-policy widen
  (DROP+CREATE in place, names unchanged).

## 5. Tests (TDD — failing first)

Unit:

- `tests/unit/role-home.test.ts` — `roleHome('procurement') === '/requests'`; `PURCHASING_ROLES`
  contains procurement and excludes nothing it had; SA/PM unchanged.
- `tests/unit/bottom-tab-bar.test.tsx` — procurement renders คำขอซื้อ + โปรไฟล์, not โครงการ/รอตรวจ;
  active-tab logic unchanged for existing roles.

pgTAP (run after the gated `db:push`):

- `08-work-packages.test.sql` — procurement can SELECT a WP; procurement still **cannot** INSERT/UPDATE.
- `20-purchase-request-attachments.test.sql` — procurement can INSERT an invoice + delivery_confirmation
  row on a matching-status parent; reference arm still inert for a non-requester.
- `21-pr-attachments-bucket.test.sql` — procurement admitted by the storage upload policy for a
  matching-status parent.

## 6. Verification

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (local).
- **Operator go/no-go before `db:push`** (migration touches prod RLS). Then `pnpm db:push`,
  `pnpm db:types` (reconcile byte-exact — no schema-shape change expected, RLS only), `pnpm db:test`.
- Update `docs/progress-tracker.md` and `docs/site-map.md` (procurement now lands on `/requests`;
  new tab set) in the same unit.

## 7. Acceptance (operator)

Sign in as a procurement-role user (or temporarily set a test account's role): land on `/requests`;
see the site's purchase requests with WP labels; open an approved request and record a purchase; open
a purchased request and record shipment; upload an invoice; confirm NO approve/reject/cancel controls
appear. SA and PM screens are unchanged.

## 8. Open questions / seams

- Procurement project hub / `projects` SELECT (when a project-scoped view is needed).
- Desktop HubNav for procurement.
- Procurement supplier-master screen.
- A procurement-specific worklist ordering (e.g. approved-awaiting-purchase first) — v1 reuses the
  shared pending-first sort.
