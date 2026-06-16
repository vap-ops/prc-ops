# PRC Ops — Workflows & Role Permissions

> Generated reference, 2026-06-13. Maps every end-to-end workflow in the app and the
> full role/RLS permission surface. Sourced from route guards (`src/app/**`), server
> actions, `src/lib/**`, and the RLS migrations under `supabase/migrations/`. Where a
> claim cites a file, that file is authoritative — re-read it before relying on a detail
> for a code change.

---

## Contents

- [Part 0 — How access is enforced](#part-0--how-access-is-enforced)
- [Part 1 — Workflows](#part-1--workflows)
  - [1. Authentication & session](#1-authentication--session)
  - [2. Work packages & approvals](#2-work-packages--approvals)
  - [3. Photos, markups & reports](#3-photos-markups--reports)
  - [4. Purchasing (purchase requests)](#4-purchasing-purchase-requests)
  - [5. Labor & payroll](#5-labor--payroll)
  - [6. Projects, clients, team, profile & notes](#6-projects-clients-team-profile--notes)
  - [7. Notifications (LINE)](#7-notifications-line)
- [Part 2 — Role permission tables](#part-2--role-permission-tables)
  - [Roles legend](#roles-legend)
  - [A. Route / surface access](#a-route--surface-access)
  - [B. Action capability matrix](#b-action-capability-matrix)
  - [C. Table-level RLS matrix (authoritative)](#c-table-level-rls-matrix-authoritative)
  - [D. Storage buckets](#d-storage-buckets)
  - [E. Special principals & RPCs](#e-special-principals--rpcs)

---

## Part 0 — How access is enforced

Three independent layers gate every action. A request must pass all that apply:

1. **Route guard** — each protected page calls `requireRole([...])`
   ([require-role.ts](src/lib/auth/require-role.ts)). Wrong role → redirect to the
   caller's `roleHome()`. `/profile` and `/coming-soon` are the exceptions: auth-only
   (any logged-in role), no role gate.
2. **RLS at the database** — every table has Row Level Security. Policies read the
   caller's role through the `public.current_user_role()` SECURITY DEFINER helper
   (ADR 0011, [fix_users_rls_recursion](supabase/migrations/20260523213246_fix_users_rls_recursion.sql)),
   never a self-join (which once caused infinite recursion). Role is the **only**
   granularity in v1 (ADR 0013) — there is no per-project or per-WP membership gate,
   except the few explicit own-row cases noted below.
3. **Append-only triple enforcement** — for `audit_log`, `photo_logs`, `labor_logs`,
   `photo_markups`, `purchase_request_attachments`: (a) UPDATE/DELETE privileges
   REVOKED from `authenticated`, (b) no UPDATE/DELETE RLS policies, (c) a `BEFORE
UPDATE/DELETE/TRUNCATE` trigger raises `P0001` — which catches even the
   service-role bypass. Edits happen by **supersede**: insert a new row whose
   `superseded_by` points at the old one; a removal is a _tombstone_ (payload NULL +
   `superseded_by` set). Current-state reads use an anti-join, not `IS NULL` (ADR 0009).

**Money isolation.** Rate/cost columns (`workers.day_rate`,
`labor_logs.day_rate_snapshot`, `wp_labor_costs.own_cost/dc_cost`,
`projects.budget_amount_thb`) have **zero** `authenticated` SELECT grant. They are read
only by server code behind a `requireRole(PM/super)` gate using the service-role admin
client, and written only through role-gated SECURITY DEFINER RPCs. Field roles can never
see money even with a hand-crafted query.

**`roleHome()` landing** ([role-home.ts](src/lib/auth/role-home.ts)):
`site_admin → /sa`, `project_manager`/`super_admin → /pm`, `procurement → /requests`,
everyone else (`visitor` default, `project_coordinator`, `technician`, `hr`,
`subcon_manager`, `accounting`) → `/coming-soon`.

---

## Part 1 — Workflows

### 1. Authentication & session

Custom LINE OAuth flow (ADR 0012); no Supabase social provider. Two login paths share
one callback.

**1.1 Browser LINE login**

- Trigger: user taps login in a browser tab.
- `GET /auth/line/start` → mints a CSRF `state` cookie, 302 to LINE authorize.
- LINE → `GET /auth/line/callback?code&state` → validates state cookie (single-use),
  exchanges `code` for an `id_token`, verifies the HS256 signature locally with
  `LINE_CHANNEL_SECRET`, asserts `iss/aud/exp/sub`.
- Admin client `createUser` on synthetic email `line_<sub>@line.local` (idempotent); a
  trigger auto-creates `public.users` with role `visitor` (ADR 0007/0010). Magic-link +
  `verifyOtp` mints the `sb-*` session cookies.
- NULL-only profile write (`line_user_id`, `full_name`), avatar refresh, then 302 by role.
- Files: [auth/line/start](src/app/auth/line/start/route.ts), [auth/line/callback](src/app/auth/line/callback/route.ts), [line-token-exchange.ts](src/lib/auth/line-token-exchange.ts), [verify-line-id-token.ts](src/lib/auth/verify-line-id-token.ts).

**1.2 PWA device-code handoff login** (ADR 0041)

- Trigger: login from an installed iOS PWA (cookies can't survive the LINE round-trip in standalone mode).
- `POST /auth/handoff/start` inserts a `login_handoffs` row (`pending`, 10-min expiry),
  returns `{device_code, authorize_url}`; PWA opens the URL in the **system browser**.
- The callback runs in the _browser's_ cookie jar with no state cookie → it falls back to
  matching a `pending` handoff row, marks it `approved`, redirects to `/login?handoff=approved`.
- PWA polls `POST /auth/handoff/poll {device_code}`; on `approved` it atomically claims
  the row (`approved → consumed`), mints the session **in the PWA context**, returns the
  role's home.
- Files: [auth/handoff/start](src/app/auth/handoff/start/route.ts), [auth/handoff/poll](src/app/auth/handoff/poll/route.ts), [handoff-flow.ts](src/lib/auth/handoff-flow.ts).

**1.3 Routing & logout**

- `proxy.ts` middleware runs `getUser()` once per request to refresh the session and
  bounces unauthenticated users to `/login` (except `PUBLIC_PATHS`). Page render uses the
  faster `getClaims()` local JWT verify (ADR 0021).
- `/login` shortcuts already-authenticated users to `roleHome()`.
- Logout: `POST /auth/logout` → `signOut()` → 303 to `/`.

### 2. Work packages & approvals

Work packages (WPs) are the unit of work — ~80 per project. ADR 0013: role-level access,
archive-never-delete.

**2.1 WP import (CSV)** — operator-run, local only.

- `pnpm import:wp <PROJECT_CODE> <file.csv>`; pure validator
  ([wp-import/parse.ts](src/lib/wp-import)) checks blank/duplicate/existing codes (fail-all,
  nothing inserted on any error); admin client (service-role, bypasses RLS) batch-inserts
  rows at status `not_started`. No edit-on-import (ADR 0014).

**2.2 WP view & filter** (SA/PM/super)

- `/sa/projects/[id]` lists WPs; client `WorkPackageList` offers a segmented control:
  งานค้าง (on_hold) · รอตรวจ (pending_approval) · เสร็จแล้ว (complete) · ทั้งหมด (all).
- If the project has deliverables, WPs group under collapsible deliverable headers with a
  progress bar; counts derive from the **unfiltered** list (spec 11/12/56).

**2.3 Photo-driven status transition**

- First **"after"** photo on a WP in `{not_started, in_progress, on_hold}` →
  `pending_approval` (admin-client UPDATE with a SQL status guard; idempotent, never
  regresses). First **"during"** photo: `not_started → in_progress` only (never releases a hold).
- File: [photos/transitions.ts](src/lib/photos/transitions.ts).

**2.4 PM approval / review** (decision: PM/super only)

- `/pm` lists `pending_approval` WPs oldest-first → `/pm/work-packages/[id]` review screen
  (photos by phase, decision history, labor cost, on-hold toggle).
- PM picks `approved | needs_revision | rejected`; a comment is **required** for
  needs_revision/rejected (DB CHECK rejects whitespace-only). `recordDecision` inserts an
  append-only `approvals` row; `approved` flips the WP to `complete` (guarded), otherwise
  status stays `pending_approval`.
- **SA can read approvals** (to see revision comments) but **cannot insert** — SAs upload,
  PMs decide. This split is load-bearing.

**WP status enum:** `not_started → in_progress → pending_approval → complete`, plus
`on_hold` (manual, spec 52). `needs_revision`/`rejected` are approval decisions, not WP
statuses — they leave the WP at `pending_approval`.

**2.5 Contractor assignment** (SA/PM/super; ADR 0033)

- WP detail → `WpAssignmentPanel`: pick or inline-create a contractor (outsider crew, no
  login), then assign. SA has no `work_packages` UPDATE policy, so assignment goes through
  the `set_work_package_contractor` SECURITY DEFINER RPC (writes `contractor_id` only).
- `owner_id` + `work_package_members` (ADR 0032) remain in the schema but **dormant** —
  cleanup candidates at v2.

### 3. Photos, markups & reports

**3.1 Photo capture & upload** (SA/PM/super; offline-tolerant, ADR 0039)

- Client downscales to ≤2000px / JPEG 0.8 (ADR 0036; passthrough on failure), assigns a
  UUID, builds path `{project}/{wp}/{photo}.{ext}`, queues the item in **IndexedDB**.
- Uploads bytes to the private `photos` bucket, then server action `addPhoto` inserts the
  `photo_logs` metadata row; only then is the queue item removed. A runner replays the
  queue on load and every 5 s with exponential backoff — survives reload/crash/offline,
  idempotent (409 = already there).

**3.2 Photo edit / remove (tombstone)** — append-only.

- `removePhoto` inserts a tombstone (`storage_path NULL`, `superseded_by = target`); the
  Storage object is left in place (v2 orphan cleanup). Reads filter tombstones +
  superseded rows via anti-join. Files: [photos/tombstone.ts](src/lib/photos), [photos/current-photos.ts](src/lib/photos).

**3.3 Photo markup** (SA/PM/super; spec 51)

- Strokes (normalized 0..1 coords) + optional comment, validated and stored in
  `photo_markups`. Removal is a tombstone; **creator-only** (RLS pins the tombstone target
  to your own rows). The `photo_markups_current` view applies the anti-join.

**3.4 Deliverable progress** — pure derivation

- `deriveDeliverableProgress` over the _unfiltered_ member-WP statuses → `{count, percent,
status}` where `complete` iff all members complete; used by headers and (future) PDF grouping.

**3.5 PDF report generation** (PM/super; ADR 0040, on-demand)

- `generateReport` checks no in-flight report for the project, parses params
  (scope `complete|all`, photos `after|all_phases|none`; spec 61), inserts a `reports` row
  at `requested`.
- **Fast path:** the same request calls `claim_next_report()` (atomic `FOR UPDATE SKIP
LOCKED`); if it claims the row it builds the PDF synchronously (PDFKit + Sarabun),
  uploads to the `reports` bucket, marks `complete`. On error → `failed`.
- **Fallbacks:** the Railway worker also polls `claim_next_report()`; a `reap_stale_reports`
  cron (every 5 min) fails rows stuck `processing` > 15 min so the duplicate guard clears.
- **Status enum:** `requested → processing → complete | failed`.

**3.6 Report download** (PM/super)

- `getReportDownloadUrl` validates `complete` + storage path, mints a 120 s service-role
  signed URL (`{code}-report-{YYYYMMDD}.pdf`, Asia/Bangkok). The `reports` bucket has no
  authenticated SELECT — all reads go through server-minted signed URLs.

### 4. Purchasing (purchase requests)

The largest workflow. One mutable `purchase_requests` row per requisition carries the full
lifecycle; **status is auto-derived by triggers** from fact columns, and every transition
writes an `audit_log` row + a `notification_outbox` row. Files:
[requests/actions.ts](src/app/requests/actions.ts), [lib/purchasing](src/lib/purchasing),
[create_purchase_requests](supabase/migrations/20260608120000_create_purchase_requests.sql).

**Status state machine**

```
                 (record purchase)      (record shipment)     (delivery-confirmation photo)
requested ──► approved ──────────► purchased ──────────► on_route ──────────────────────► delivered
   │             │   (PM/super)      (PM/proc/super)       (PM/proc/super)                 (SA/PM/super upload)
   │             └─► cancelled  (PM/super)
   └─► rejected  (PM/super)

site_purchased  ◄── born terminal via record_site_purchase RPC (SA/PM/super), PM/super acknowledge
```

| Transition                         | Who               | Mechanism                                                                 |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| → `requested`                      | SA / PM / super   | `createPurchaseRequest` (session INSERT, `source='app'`)                  |
| `requested → approved \| rejected` | PM / super        | `decidePurchaseRequest` (reject needs comment; two-layer guard)           |
| `requested → ` (no purchase)       | —                 | n/a                                                                       |
| `approved → purchased`             | PM / proc / super | `record_purchase` RPC (supplier, order_ref, amount, eta) → derive trigger |
| `approved → cancelled`             | PM / super        | `cancelPurchaseRequest`                                                   |
| `purchased → on_route`             | PM / proc / super | `record_shipment` RPC → derive trigger                                    |
| `on_route → delivered`             | SA / PM / super   | upload `delivery_confirmation` photo → completion trigger                 |
| → `site_purchased` (terminal)      | SA / PM / super   | `record_site_purchase` RPC (cash buy on site, ADR 0043)                   |
| acknowledge site purchase          | PM / super        | `acknowledge_site_purchase` RPC (stamps ack, no status change)            |

- **Invoice/receipt upload** (SA/PM/super/**proc**): `addInvoiceAttachment` into
  `purchase_request_attachments` (purpose `invoice`) while status ∈
  `{purchased, on_route, delivered, site_purchased}`. Does **not** auto-complete delivery —
  only a `delivery_confirmation` photo does.
- **Back-office fact writes** historically came from the `appsheet_writer` DB role (ADR
  0025); the in-app RPC path (ADR 0038) is now primary and AppSheet is being sunset
  (ADR 0034). `appsheet_writer` still has column-scoped UPDATE on fact columns for rows in
  `{approved, purchased, on_route, delivered}`.
- **Notes:** `purchase_requests.notes` editable by the requester or PM/proc/super (spec 48/72/73).

### 5. Labor & payroll

Two worker types: **own-crew** (salaried technicians, presence only) and **DC** (outsourced
subcontractors, daily-logged for payroll). All writes go through SECURITY DEFINER RPCs;
all money is server-side only.

**5.1 Worker roster** (PM/super) — `/workers`

- Add/edit worker (name, type, day_rate, contractor for DC, note) via `create_worker` /
  `update_worker` / `set_worker_day_rate` RPCs (each role-gated, audited). No delete —
  retirement via `active=false`.

**5.2 Log labor** (SA/PM/super)

- WP detail labor zone: pick date (≤ today), workers, fraction (full/half), optional note.
  `log_labor_day` RPC takes an advisory lock on `(wp, worker, date)`, enforces one current
  entry, **snapshots** rate/name/type/contractor at entry time, inserts (append-only).
  `self_logged = (entered_by == worker.user_id)`.

**5.3 Correct labor** (SA/PM/super) — supersede

- `correct_labor_log` RPC inserts a new row (`superseded_by = original`); change fraction or
  tombstone (remove). Reason required. Original is never mutated. Tombstones can't be corrected.

**5.4 View / freeze cost** (PM/super)

- `aggregateLaborCost` over current rows: `cost = fraction × rate_snapshot`, own vs DC split,
  per-worker breakdown, cross-WP over-allocation surfaced (never blocked).
- Auto-freeze on WP → `complete`; manual **re-freeze** via `freeze_wp_labor_cost` RPC when
  drift is shown. `wp_labor_costs` is **deliberately mutable** (one row/WP, UPSERT); the
  audit log is the change history (spec 46).

**5.5 Payroll export** (PM/super) — `/pm/payroll`

- DC workers only. Period picker (defaults to current Bangkok month) → grouped summary;
  `/pm/payroll/export` returns CSV (UTF-8 BOM for Excel Thai). Page + export share the
  fetch/aggregate so figures can't disagree.

### 6. Projects, clients, team, profile & notes

**6.1 Project settings** (PM/super) — `/sa/projects/[id]/settings`

- Edit name, status, notes, address, dates, type, lead, budget, client. Read via
  authenticated client; `budget_amount_thb` + clients/staff read via admin client (budget
  SELECT revoked from authenticated). Write via `update_project_settings` RPC (role-checked
  inside, re-validates, maps `22023` to Thai errors). `contract_reference` is read-only.
  Spec 79, ADR 0042.

**6.2 Project team** (PM/super; spec 80)

- Add/remove `project_members` (idempotent add; `added_by` pinned). Team names show on the
  project detail header. Membership is **display metadata only — not an access gate** (ADR 0013).

**6.3 Client master** (PM/super create/edit, SA read; spec 79)

- Inline "เพิ่มลูกค้าใหม่" create + select; `set_project_client` RPC assigns/clears the FK.
  Client name shows on the project header and `/pm/projects` list.

**6.4 Profile self-edit** (all authenticated) — `/profile`

- Edit display name; `update_my_display_name` SECURITY DEFINER RPC (≤80 chars, audited).
  No role gate — anyone can edit **their own** name. Direct `users` UPDATE is revoked from
  authenticated (ADR 0019); this RPC is the only self-write path.

**6.5 Notes** — shared `NotesField` (spec 72)

- `work_package.notes` (SA read / PM-super write), `purchase_requests.notes`
  (requester or PM/proc/super), `project.notes` (PM/super). Trim → NULL on blank, ≤1000 chars.
  Written via the `set_work_package_notes` / `set_purchase_request_notes` RPCs.

### 7. Notifications (LINE)

Async outbox, never blocks the originating write.

**7.1 Event capture** — SECURITY DEFINER triggers insert `notification_outbox` rows and
swallow their own errors (`RAISE WARNING`, return NEW):

- `wp_pending_approval` (WP → pending_approval) → all PMs
- `wp_decision` (approvals INSERT) → uploaders
- `pr_created` (PR INSERT, status requested) → PMs
- `pr_decision` / `pr_progress` / `pr_cancelled` (PR status changes) → requester

**7.2 Outbox drain** — `pg_cron` (every minute) → `invoke_notification_drain()` → pg_net
POST to `/api/notifications/drain` with `x-drain-secret`:

- Reclaim `sending` > 10 min → `pending`; expire `pending` > 24 h → `expired`.
- Claim 50 oldest `pending` → `sending`; resolve recipients, compose Thai text, push to LINE
  Messaging API per recipient (`line_user_id`).
- Per row: any success or zero recipients → `sent`; else `attempts++`, → `failed` at 3.
- **Status enum:** `pending → sending → sent | failed | expired`.
- Table is service-role-only: zero authenticated/anon access, inserts only by the triggers.

---

## Part 2 — Role permission tables

### Roles legend

`users.role` is a 10-value enum. v1-live roles reach real surfaces; the rest land on `/coming-soon`.

| Role                | Code                       | v1?                     | Lands on                                 |
| ------------------- | -------------------------- | ----------------------- | ---------------------------------------- |
| Site admin          | `site_admin` (SA)          | ✅                      | `/sa`                                    |
| Project manager     | `project_manager` (PM)     | ✅                      | `/pm`                                    |
| Super admin         | `super_admin`              | ✅ full-access operator | `/pm` (+ operator hub on `/coming-soon`) |
| Procurement         | `procurement` (PROC)       | ✅ back-office          | `/requests`                              |
| Project coordinator | `project_coordinator` (PC) | v2                      | `/coming-soon`                           |
| Technician          | `technician`               | v2/3                    | `/coming-soon`                           |
| HR                  | `hr`                       | v3                      | `/coming-soon`                           |
| Subcon manager      | `subcon_manager`           | v3                      | `/coming-soon`                           |
| Accounting          | `accounting`               | v3                      | `/coming-soon`                           |
| Visitor             | `visitor`                  | v1 default (new signup) | `/coming-soon`                           |

Below, **"Others"** = visitor + all v2/v3 roles (no live surface). Legend: ✅ allowed · — denied
· 🔑 only via role-gated SECURITY DEFINER RPC · 👁 read-only / column-restricted · ⛔ no one (blocked for all).

### A. Route / surface access

Enforced by `requireRole` unless noted. Wrong role → redirect to `roleHome()`.

| Route                                                              |   SA    |   PM    |    Super     |     Proc     |     Others      |
| ------------------------------------------------------------------ | :-----: | :-----: | :----------: | :----------: | :-------------: |
| `/login`, `/auth/*` (public)                                       |   ✅    |   ✅    |      ✅      |      ✅      |       ✅        |
| `/` (home)                                                         | →`/sa`  | →`/pm`  |    →`/pm`    | →`/requests` | →`/coming-soon` |
| `/profile` (auth-only, no role gate)                               |   ✅    |   ✅    |      ✅      |      ✅      |       ✅        |
| `/coming-soon`                                                     | bounced | bounced | operator hub |   bounced    |  ✅ wait page   |
| `/sa`, `/sa/projects/[id]`, `/sa/projects/[id]/work-packages/[id]` |   ✅    |   ✅    |      ✅      |      —       |        —        |
| `/sa/projects/[id]/settings`                                       |    —    |   ✅    |      ✅      |      —       |        —        |
| `/pm`, `/pm/projects`, `/pm/work-packages/[id]`                    |    —    |   ✅    |      ✅      |      —       |        —        |
| `/pm/payroll`, `/pm/payroll/export`                                |    —    |   ✅    |      ✅      |      —       |        —        |
| `/pm/projects/[id]/reports`                                        |    —    |   ✅    |      ✅      |      —       |        —        |
| `/workers`                                                         |    —    |   ✅    |      ✅      |      —       |        —        |
| `/requests`, `/requests/[id]`                                      |   ✅    |   ✅    |      ✅      |     ✅¹      |        —        |

¹ Procurement reaches `/requests` but the create form is hidden (`canCreateRequests = role !== 'procurement'`) — they process, not requisition.

Nav UI: `BottomTabBar` (mobile) and `HubNav` (desktop ≥sm) render per role — `SA_TABS`,
`PM_TABS`, `PROCUREMENT_TABS`; null for Others (no bar). See [bottom-tab-bar.tsx](src/components/features/bottom-tab-bar.tsx), [hub-nav.tsx](src/components/features/hub-nav.tsx).

### B. Action capability matrix

| Action                                   | SA  | PM  | Super |     Proc      | Enforced at                                               |
| ---------------------------------------- | :-: | :-: | :---: | :-----------: | --------------------------------------------------------- |
| Create purchase request                  | ✅  | ✅  |  ✅   |       —       | RLS INSERT (WP-reader, `source='app'`) + UI hide for proc |
| Approve / reject PR                      |  —  | ✅  |  ✅   |       —       | RLS UPDATE + action guard                                 |
| Cancel approved PR                       |  —  | ✅  |  ✅   |       —       | action guard + RLS                                        |
| Record purchase / shipment               |  —  | ✅  |  ✅   |      ✅       | `record_purchase` / `record_shipment` RPC                 |
| Record on-site cash purchase             | ✅  | ✅  |  ✅   |       —       | `record_site_purchase` RPC                                |
| Acknowledge site purchase                |  —  | ✅  |  ✅   |       —       | `acknowledge_site_purchase` RPC                           |
| Upload delivery-confirmation photo       | ✅  | ✅  |  ✅   |       —       | RLS INSERT on attachments                                 |
| Upload invoice/receipt                   | ✅  | ✅  |  ✅   |      ✅       | RLS INSERT (widened spec 70)                              |
| Create / edit supplier                   |  —  | ✅  |  ✅   |      ✅       | RLS (back-office; SA excluded)                            |
| Upload / remove progress photo           | ✅  | ✅  |  ✅   |       —       | RLS INSERT on `photo_logs`                                |
| Add / remove photo markup                | ✅  | ✅  |  ✅   |       —       | RLS (remove = own only)                                   |
| Approve WP (insert decision)             |  —  | ✅  |  ✅   |       —       | RLS — **SA uploads, can't approve**                       |
| Assign contractor to WP                  | ✅  | ✅  |  ✅   |       —       | `set_work_package_contractor` RPC                         |
| Create / edit contractor                 | ✅  | ✅  |  ✅   |       —       | RLS (widened spec 31)                                     |
| Create project                           |  —  |  —  |  ✅   |       —       | RLS INSERT (super only)                                   |
| Edit project settings / team / client    |  —  | ✅  |  ✅   |       —       | `update_project_settings` etc. RPCs                       |
| Manage workers / set rates / freeze cost |  —  | ✅  |  ✅   |       —       | worker/freeze RPCs (money)                                |
| Log / correct labor                      | ✅  | ✅  |  ✅   |       —       | `log_labor_day` / `correct_labor_log` RPC                 |
| View labor cost / payroll                |  —  | ✅  |  ✅   |       —       | route guard + admin-client read (money)                   |
| Generate / download PDF report           |  —  | ✅  |  ✅   |       —       | RLS + action guard                                        |
| Edit own display name                    | ✅  | ✅  |  ✅   | ✅ (all auth) | `update_my_display_name` RPC                              |

### C. Table-level RLS matrix (authoritative)

Roles listed are `authenticated` app roles unless marked. ⛔ = no policy/privilege for anyone
(service-role context only). Append-only tables (✱) reject UPDATE/DELETE via triple enforcement.

| Table                                 | SELECT                                   | INSERT                                 | UPDATE                                                           | DELETE     |
| ------------------------------------- | ---------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `projects`                            | SA · PM · super                          | super                                  | super (PM via `update_project_settings` RPC)                     | ⛔         |
| &nbsp;&nbsp;↳ `budget_amount_thb` col | PM · super (admin client only)           | —                                      | via RPC                                                          | —          |
| `clients`                             | SA · PM · super                          | PM · super                             | PM · super                                                       | ⛔         |
| `project_members`                     | SA · PM · super                          | PM · super                             | —                                                                | PM · super |
| `work_packages`                       | SA · PM · **proc** · super               | PM · super                             | PM · super (SA→`contractor_id` via RPC)                          | ⛔         |
| `deliverables`                        | SA · PM · super                          | PM · super                             | PM · super                                                       | ⛔         |
| `contractors`                         | SA · PM · super                          | SA · PM · super                        | SA · PM · super (name/phone)                                     | ⛔         |
| `work_package_members` (dormant)      | SA · PM · super                          | PM · super                             | —                                                                | PM · super |
| `photo_logs` ✱                        | SA · PM · super                          | SA · PM · super (+tombstone)           | ⛔                                                               | ⛔         |
| `photo_markups` ✱                     | SA · PM · super                          | SA · PM · super (tombstone = own only) | ⛔                                                               | ⛔         |
| `approvals` ✱                         | SA · PM · super                          | **PM · super** (not SA)                | ⛔                                                               | ⛔         |
| `reports`                             | PM · super                               | PM · super                             | service_role only                                                | ⛔         |
| `purchase_requests`                   | own-row · SA · PM · proc · super         | SA · PM · super (`source='app'`)       | PM · super (status/decision cols); `appsheet_writer` (fact cols) | ⛔         |
| `purchase_request_attachments` ✱      | via readable parent                      | SA · PM · super · proc                 | ⛔                                                               | ⛔         |
| `purchase_request_attachment_tokens`  | ⛔ (service_role)                        | trigger only                           | ⛔                                                               | —          |
| `suppliers`                           | SA · PM · proc · super                   | PM · proc · super                      | PM · proc · super                                                | ⛔         |
| `workers`                             | SA · PM · proc · super (no `day_rate`)   | PM · super (RPC)                       | PM · super (RPC)                                                 | ⛔         |
| `labor_logs` ✱                        | SA · PM · super (no `day_rate_snapshot`) | SA · PM · super (RPC)                  | ⛔ (correct via RPC)                                             | ⛔         |
| `wp_labor_costs`                      | ⛔ (service_role / admin client)         | freeze RPC (PM·super)                  | freeze RPC (UPSERT)                                              | —          |
| `users`                               | own row (all auth); super = all          | (trigger on signup)                    | own `full_name` via RPC; super via admin client                  | ⛔         |
| `audit_log` ✱                         | all authenticated                        | authenticated                          | ⛔                                                               | ⛔         |
| `notification_outbox`                 | ⛔ (drainer)                             | triggers only                          | ⛔ (drainer)                                                     | —          |

Notes:

- **Own-row reads:** `purchase_requests` SELECT also matches `requested_by = auth.uid()`; SA
  was widened to see all rows ([widen_select](supabase/migrations/20260613100050_widen_purchase_requests_select_site_admin.sql)).
- **`appsheet_writer`** sees only `{approved, purchased, on_route, delivered}` rows and can
  UPDATE a fixed set of fact columns; it never calls `current_user_role()` (returns NULL for
  that DB role) — it has its own `TO appsheet_writer` policies.
- **`super_admin`** has a full-access policy on `users`; for writing other users' roles it
  needs the admin client (authenticated UPDATE on `users` is revoked).

### D. Storage buckets

All private; downloads only via service-role-minted signed URLs (TTL 120 s).

| Bucket           | Upload                 | Download                  | Notes                                                                      |
| ---------------- | ---------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `photos`         | SA · PM · super        | service_role (signed URL) | `{project}/{wp}/{photo}.{ext}`, ≤25 MiB, image MIME only                   |
| `pr-attachments` | SA · PM · super · proc | service_role (signed URL) | dual-gate: reference (own + requested) or confirmation/invoice (by status) |
| `reports`        | service_role (worker)  | service_role (signed URL) | PDFs only, ≤50 MiB                                                         |

### E. Special principals & RPCs

- **`authenticated`** — any logged-in user; RLS + `current_user_role()` decide everything.
- **`appsheet_writer`** — dedicated DB role (direct Postgres auth, no JWT) for back-office
  purchase-fact writes (ADR 0018/0025). Being sunset in favor of the in-app RPC path (ADR
  0034/0038).
- **`service_role`** — admin client ([admin.ts](src/lib/db/admin.ts), `server-only`); bypasses
  RLS. Used by: WP import, report worker/fast-path, signed-URL minting, notification drain,
  and money-column reads behind a `requireRole` gate.
- **SECURITY DEFINER RPCs** (role-gated inside, raise `42501` on wrong role): `record_purchase`,
  `record_shipment`, `record_site_purchase`, `acknowledge_site_purchase`,
  `set_work_package_contractor`, `create_worker`, `update_worker`, `set_worker_day_rate`,
  `log_labor_day`, `correct_labor_log`, `freeze_wp_labor_cost`, `update_project_settings`,
  `set_project_client`, `set_work_package_notes`, `set_purchase_request_notes`,
  `update_my_display_name`, `claim_next_report`, `reap_stale_reports`,
  `invoke_notification_drain`, plus `current_user_role()` (the RLS helper).
- **SECURITY DEFINER triggers** — purchase-status derive + audit, delivery completion,
  WP-status helpers, and the four `notify_*` capture functions.
