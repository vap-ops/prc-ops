# Spec 47 — Purchase request detail page (click opens order details)

**Status:** locked — 2026-06-12. Operator brief: "Clicking should open into
order details." Today a /requests card does nothing on tap; every fact and
action is crammed inline on the card (tracker, attachments, uploaders, four
role-gated action zones), which made the list heavy and the card itself
inert. This spec gives each request its own screen and turns the list card
into a slim tappable summary.

## Scope

### A. New route `/requests/[requestId]` — the order detail screen

- Auth: `requireRole(["site_admin", "project_manager", "super_admin"])` —
  byte-same gate as `/requests` (ADR 0022/0026 visibility doctrine; RLS
  decides row readability, the page never re-derives it).
- Param handling mirrors the `?wp=` convention on /requests: a param
  without UUID shape, or a row RLS filters out, renders `notFound()` —
  "unknown" and "not allowed" stay indistinguishable.
- Layout: standard detail-screen anatomy (ui-conventions §5) — light
  breadcrumb header (detail screens are content, not chrome — no
  AppHeader band), `PAGE_MAX_W`, BottomTabBar (route lives under
  `/requests` so the คำขอซื้อ tab stays active by longest-prefix match).
- Header strip: back link `← คำขอซื้อ` → `/requests` (spec 12 doctrine:
  fixed, deterministic target); WP line `code · name` linking to the WP
  screen (`/sa/projects/{projectId}/work-packages/{wpId}` — the route
  every authorized role can open, same resolution as the /requests
  back-affordance); title row = `PR-XXXX` mono + item description,
  status + priority pills right.
- Body (everything the fat card carried, unchanged in behavior):
  - quantity/unit, requester (+ ของฉัน badge), requested date, needed-by;
  - `PurchaseRequestTracker` (stage dates + ETA);
  - rejection comment block (rejected + comment);
  - supplier / receiver / delivery-note facts;
  - reference images + links with `AttachmentRemoveButton` (own,
    requested-status) and the เพิ่มรูปหรือลิงก์ stager expander (own,
    requested-status);
  - delivery-confirmation photos + `DeliveryPhotoUploader`
    (on_route/delivered);
  - role-gated action zones, same gates byte-for-byte:
    `PurchaseRequestDecision` (decider × requested), `PurchaseRecordForm`
    (back-office × approved, suppliers fetched only then),
    `PurchaseRequestShip` (back-office × purchased),
    `PurchaseRequestCancel` (decider × approved).
- Static `metadata.title: "รายละเอียดคำขอซื้อ"` (template from spec 14 G).

### B. Slim clickable list card

New server-presentational component
`src/components/features/purchase-request-card.tsx`: the whole card is one
`<Link href="/requests/{id}">` (no interactive children — the tracker is
already server-safe by spec 22). Card keeps the at-a-glance set: WP
`code · name` line, `PR-XXXX` + item + quantity·unit, ของฉัน badge +
requester + requested date, needed-by line, status/priority pills,
tracker. Card affordances follow the WP-row convention (spec 40): hover
wash, `focus-visible` ring, chevron `›` right edge.

Everything else **moves** to the detail page (attachments, expander,
uploaders, rejection comment, supplier/receiver/note, all four action
zones). `/requests/page.tsx` renders the component per row; its
pending-first ordering, ของฉัน chip, pinned `?wp=` create-form mode, and
the lifecycle hint paragraph are untouched.

Recorded consequence: PM decisions and back-office recording are now one
tap deeper (list → detail). Accepted — the list becomes scannable, and
the actions gain room on their own screen.

### Out of scope

No DB/RLS/enum change, no new status, no list pagination (queued small),
no /requests redesign beyond the card swap, no procurement-role access
change (recorded seam stands).

## Tests

- **Failing first:** `tests/unit/purchase-request-card.test.tsx` — card
  renders an anchor to `/requests/{id}`; shows the padded PR number, item
  description, Thai status label; renders NO form/button (slimness is the
  contract).
- Existing pins expected untouched: tracker contract tests
  (`purchase-request-tracker.test.tsx`), pending-order comparator,
  auth e2e (no /requests DOM pins exist).

## Verification checklist

- [ ] New card test RED before the component exists, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] `pnpm build` passes (new dynamic route compiles).
- [ ] Auth e2e suite green.
- [ ] Bad/foreign `requestId` → Thai 404 (manual or test).
- [ ] All four action zones render on the detail page under the same
      role × status gates as before (code-review check).
- [ ] No diff under `supabase/` or `worker/`.
