# Site map

Audited 2026-06-13 (current through spec 70). Every route, its gate, how
users arrive, and where "back" goes. **Nav changes must update this doc in
the same unit** (same contract as ui-conventions.md).

Principle: the WP list at `/projects/[id]` is THE project page for
every role (WP-centric doctrine). Round-trip rule: entering a detail
surface from a hub, the back affordance returns to that same hub.

Spec 82 (in progress): the URL names the surface, not the viewer's role.
Unit 1 moved the project detail surfaces `/sa/projects/*` → `/projects/*`;
Unit 2 moved reports `/pm/projects/[id]/reports` → `/projects/[id]/reports`;
Unit 3 folded the two project hubs (`/sa`, `/pm/projects`) into one `/projects`
hub (role only decides the chrome) and retired `projectHubHref`; Unit 4 moved
the remaining role-named surfaces — `/pm` → `/review`, `/pm/work-packages` →
`/review/work-packages`, `/pm/payroll` → `/payroll`, `/pm/contacts` →
`/contacts` (307 redirects keep old deep links resolving). Only Unit 5 (promote
307s → permanent, drop dead rules) remains. The lone survivor under `/pm` is the
spec-19 `/pm/requests` → `/requests` legacy 308 (out of scope; Unit 5 candidate).

## Entry and auth

| Route                                       | Gate        | Notes                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                         | public      | redirects: session → `roleHome(role)`, none → `/login`                                                                                                                                                                                                                                                                                    |
| `/login`                                    | public      | LINE login; standalone PWA uses device-code handoff                                                                                                                                                                                                                                                                                       |
| `/auth/line/start`, `/auth/line/callback`   | public      | LINE OAuth start + return (browser + handoff flows)                                                                                                                                                                                                                                                                                       |
| `/auth/handoff/start`, `/auth/handoff/poll` | public POST | ADR 0041 device-code handoff                                                                                                                                                                                                                                                                                                              |
| `/auth/logout`                              | session     | clears the session, returns to `/login`                                                                                                                                                                                                                                                                                                   |
| `/coming-soon`                              | session     | unserved roles' landing (`roleHome`)                                                                                                                                                                                                                                                                                                      |
| `/profile`                                  | session     | display name, avatar, logout (reached via ตั้งค่า)                                                                                                                                                                                                                                                                                        |
| `/settings`                                 | session     | ตั้งค่า hub (spec 93): บัญชี (→ /profile + logout, all roles) · ข้อมูลหลัก (→ /contacts, /workers) + การเงิน (→ /payroll), PM/super only · เร็วๆนี้ (Nova, คลังเอกสาร — greyed coming-soon, spec 98). **Spec 153: renders the desktop HubNav (the role's strip via `hubNavForRole`, current = ตั้งค่า) — previously a desktop dead-end.** |

`roleHome`: site_admin → `/projects` · pm/super → `/review` · procurement →
`/requests` (spec 70) · others → `/coming-soon`. (spec 82)

## Bottom tabs (phones)

Spec 93: the bar holds daily-decision surfaces only; contacts/workers/payroll +
the account (profile + logout) moved into the **ตั้งค่า** (`/settings`) hub. The
ตั้งค่า tab lights on `/profile`, `/contacts`, `/workers`, `/payroll` too (match).
Desktop HubNav mirrors this (deciders + ตั้งค่า).

- SA: โครงการ `/projects` · คำขอซื้อ `/requests` · ภาพรวม `/dashboard` · ตั้งค่า `/settings`
- PM/super: รอตรวจ `/review` · โครงการ `/projects` · คำขอซื้อ `/requests` · ภาพรวม `/dashboard` ·
  ตั้งค่า `/settings`
- procurement (spec 70, 101, 102): คำขอซื้อ `/requests` · โครงการ `/projects` (read-only, spec 102) ·
  ผู้ขาย `/contacts/vendors` (suppliers-only) · ตั้งค่า `/settings` (not a decider, no ภาพรวม).
  Desktop: PROCUREMENT_HUB_NAV mirrors it.

**Spec 100 — ภาพรวม is now live** (`/dashboard`, role-aware overview), graduating the spec-98
coming-soon placeholder. Desktop HubNav mirrors it (SA + PM, before ตั้งค่า). The bottom-bar/hub
coming-soon mechanism was retired (ภาพรวม was its only user). The coming-soon concept remains for the
ตั้งค่า hub's เร็วๆนี้ rows: `Nova` + `คลังเอกสาร` (greyed, via `ComingSoonBadge`).

- **Exception (Field-First reskin Unit 1):** the WP detail page
  (`/projects/[id]/work-packages/[id]`) renders NO bottom tab bar — the fixed
  capture bar takes the thumb zone and the back chip handles return. This is
  the one screen where the tab bar gives way; every other screen keeps it.

## Project surfaces

| Route                                                                        | Gate                                  | Rows / actions →                                                                                                                                                                                                                                                                                                                                                                                                                            | Back →                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `/projects` (THE project hub, folded) (spec 82 Unit 3)                       | sa/pm/super                           | project → `/projects/[id]`; role only sets the kicker + desktop HubNav set                                                                                                                                                                                                                                                                                                                                                                  | — (hub)                                                      |
| `/projects/[id]` — **THE project page** (WP list, view filter) (spec 82)     | sa/pm/super (+ coordinator read-only) | WP → WP detail · รายงาน chip (pm/super) → reports · gear (pm/super) → settings · calendar chip → schedule (SITE_STAFF only). **Spec 154: a `project_coordinator` (in PROJECT_VIEW_ROLES, not SITE_STAFF) gets the SAME manager-grade lens list but READ-ONLY — WP rows are non-interactive (no link/chevron) and no calendar chip, since WP detail + schedule gate SITE_STAFF and would bounce it (ADR 0056 keeps those SITE_STAFF-only).** | `/projects` (single hub; projectHubHref retired)             |
| `/projects/[id]/work-packages/[id]` — WP detail (Field-First, reskin Unit 1) | sa/pm/super                           | nameplate hero · **shutter-first**: fixed amber capture bar opens the CaptureSheet · photos/requests/labor fold into disclosure · request card → `/requests/[id]`. **NO BottomTabBar** — the capture bar owns the thumb zone; the back chip is the only return nav (exception to the global bottom-tabs contract, see below)                                                                                                                | `/projects/[id]` (back chip)                                 |
| `/projects/[id]/settings`                                                    | pm/super                              | name/status form (ADR 0042)                                                                                                                                                                                                                                                                                                                                                                                                                 | `/projects/[id]`                                             |
| `/projects/[id]/reports` (spec 82 Unit 2)                                    | pm/super                              | generate/download PDFs                                                                                                                                                                                                                                                                                                                                                                                                                      | back chip → `/projects/[id]` (spec 60; the link row is gone) |
| `/projects/[id]/schedule` — KANNA-style Gantt (spec 92 Unit D)               | sa/pm/super                           | WP bars on a timeline grouped by งวดงาน · critical path + dependencies · shows ALL WPs (completed rendered muted/non-vivid) · วัน/สัปดาห์/เดือน zoom · tap a bar → highlight chain + selection bar to open; "เปิดรายละเอียดงาน" → WP detail. Reached via the calendar chip in the project-page header (all staff).                                                                                                                          | back chip → `/projects/[id]`                                 |

## Review surfaces

| Route                                                                         | Gate     | Rows / actions →                                    | Back →                              |
| ----------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ----------------------------------- |
| `/review` (review queue) (spec 82 Unit 4)                                     | pm/super | WP → `/review/work-packages/[id]`                   | — (hub)                             |
| `/review/work-packages/[id]` — PM WP review (photos, decision, hold toggle)   | pm/super | decision form · สร้างคำขอซื้อ → `/requests?wp=`     | `/review` (queue is the entry)      |
| `/payroll` — DC payroll rollup + CSV export (money, spec 69) (spec 82 Unit 4) | pm/super | period rollup of DC days by contractor · CSV export | — (desktop PM HubNav ค่าจ้าง entry) |

## Purchasing surfaces

`PURCHASING_ROLES` = sa/pm/super **+ procurement** (spec 70). Procurement is a
back-office processor: it records purchases/shipments and files invoices +
delivery photos, but sees NO create-request section and NO decision/cancel
controls, and its WP reference is plain text (the WP detail route bounces it).

| Route            | Gate             | Rows / actions →                                                                                                              | Back →      |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `/requests`      | PURCHASING_ROLES | card → `/requests/[id]` · create form (hidden for procurement)                                                                | — (hub/tab) |
| `/requests/[id]` | PURCHASING_ROLES | decision/cancel (pm/super) · record/ship + invoice/delivery upload (back office) · WP line → WP detail (text for procurement) | `/requests` |

## Other

| Route                   | Gate        | Notes                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/dashboard`            | session     | ภาพรวม — role-aware portfolio overview (spec 100). Primary tab (no back chip). ALL staff see progress + attention; PM/super additionally see budget vs spend (money via admin client). Live projects only. **Spec 153: renders the desktop HubNav (`hubNavForRole`, current = ภาพรวม) — previously a desktop dead-end.** |
| `/workers`              | pm/super    | labor roster (spec 46). **No nav entry yet** — reachable by URL only; recorded seam.                                                                                                                                                                                                                                     |
| `/contacts`             | session     | redirect → `/contacts/customers` (spec 99 — keeps old links + the bottom-bar match alive).                                                                                                                                                                                                                               |
| `/contacts/customers`   | pm/super    | ลูกค้า (clients). Spec 99 group. Reached from ตั้งค่า › ข้อมูลหลัก; back chip → /settings.                                                                                                                                                                                                                               |
| `/contacts/vendors`     | back-office | PM/super: ผู้ขาย + ผู้ให้บริการ (spec 99), detail links, back → /settings. **procurement (spec 101): suppliers-only, inline edit (no detail link → no bank), back → /requests.** Gate = BACK_OFFICE_ROLES.                                                                                                               |
| `/contacts/crews`       | pm/super    | ผู้รับเหมา + DC (the one contractors table split by category). Spec 99 group; status filter both tabs. Back → /settings.                                                                                                                                                                                                 |
| `/contacts/[type]/[id]` | pm/super    | contact detail (clients/suppliers/contractors/service-providers): read-only fields + money-isolated bank + documents + crew (specs 81–97). Reached from a group list row; back → its list.                                                                                                                               |

## Known seams (recorded, not defects)

- `/workers` nav entry pending its own small spec.
- `/payroll` (ค่าจ้าง) is in the desktop PM HubNav (`hub-nav.tsx`) only — the
  phone bottom-tab bar has no entry for it yet (same gap as `/workers`).
- procurement is onboarded onto the purchasing worklist (spec 70) but has no
  project hub (`projects` SELECT deferred) and no desktop HubNav — recorded
  seams for later units. The `/contacts` supplier screen (spec 81) is
  PM-gated; procurement (a supplier writer at the data layer) does not reach it
  yet — its own widening unit.
- SA quick-adds a contractor inline on WP assignment (spec 31) but does not
  reach `/contacts` to curate contacts — recorded seam.
