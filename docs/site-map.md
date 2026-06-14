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

| Route                                       | Gate        | Notes                                                  |
| ------------------------------------------- | ----------- | ------------------------------------------------------ |
| `/`                                         | public      | redirects: session → `roleHome(role)`, none → `/login` |
| `/login`                                    | public      | LINE login; standalone PWA uses device-code handoff    |
| `/auth/line/start`, `/auth/line/callback`   | public      | LINE OAuth start + return (browser + handoff flows)    |
| `/auth/handoff/start`, `/auth/handoff/poll` | public POST | ADR 0041 device-code handoff                           |
| `/auth/logout`                              | session     | clears the session, returns to `/login`                |
| `/coming-soon`                              | session     | unserved roles' landing (`roleHome`)                   |
| `/profile`                                  | session     | display name, avatar, logout (PWA's logout home)       |

`roleHome`: site_admin → `/projects` · pm/super → `/review` · procurement →
`/requests` (spec 70) · others → `/coming-soon`. (spec 82)

## Bottom tabs (phones)

- SA: โครงการ `/projects` · คำขอซื้อ `/requests` · โปรไฟล์ `/profile`
- PM/super: รอตรวจ `/review` · โครงการ `/projects` · คำขอซื้อ `/requests` · ติดต่อ
  `/contacts` (spec 81) · โปรไฟล์ `/profile`
- procurement (spec 70): คำขอซื้อ `/requests` · โปรไฟล์ `/profile` (no project
  hub, not a decider)
- **Exception (Field-First reskin Unit 1):** the WP detail page
  (`/projects/[id]/work-packages/[id]`) renders NO bottom tab bar — the fixed
  capture bar takes the thumb zone and the back chip handles return. This is
  the one screen where the tab bar gives way; every other screen keeps it.

## Project surfaces

| Route                                                                        | Gate        | Rows / actions →                                                                                                                                                                                                                                                                                                             | Back →                                                       |
| ---------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `/projects` (THE project hub, folded) (spec 82 Unit 3)                       | sa/pm/super | project → `/projects/[id]`; role only sets the kicker + desktop HubNav set                                                                                                                                                                                                                                                   | — (hub)                                                      |
| `/projects/[id]` — **THE project page** (WP list, view filter) (spec 82)     | sa/pm/super | WP → WP detail · รายงาน chip (pm/super) → reports · gear (pm/super) → settings                                                                                                                                                                                                                                               | `/projects` (single hub; projectHubHref retired)             |
| `/projects/[id]/work-packages/[id]` — WP detail (Field-First, reskin Unit 1) | sa/pm/super | nameplate hero · **shutter-first**: fixed amber capture bar opens the CaptureSheet · photos/requests/labor fold into disclosure · request card → `/requests/[id]`. **NO BottomTabBar** — the capture bar owns the thumb zone; the back chip is the only return nav (exception to the global bottom-tabs contract, see below) | `/projects/[id]` (back chip)                                 |
| `/projects/[id]/settings`                                                    | pm/super    | name/status form (ADR 0042)                                                                                                                                                                                                                                                                                                  | `/projects/[id]`                                             |
| `/projects/[id]/reports` (spec 82 Unit 2)                                    | pm/super    | generate/download PDFs                                                                                                                                                                                                                                                                                                       | back chip → `/projects/[id]` (spec 60; the link row is gone) |
| `/projects/[id]/schedule` — KANNA-style Gantt (spec 92 Unit D)               | sa/pm/super | WP bars on a timeline grouped by งวดงาน · critical path + dependencies · เดือน/ไตรมาส/ปี switch · tap a bar → highlight chain; "เปิดรายละเอียดงาน" → WP detail. Reached via the calendar chip in the project-page header (all staff).                                                                                        | back chip → `/projects/[id]`                                 |

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

| Route       | Gate     | Notes                                                                                                                                                                                                                      |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/workers`  | pm/super | labor roster (spec 46). **No nav entry yet** — reachable by URL only; recorded seam.                                                                                                                                       |
| `/contacts` | pm/super | contacts management (spec 81; spec 82 Unit 4 route): clients / suppliers / contractors via a segmented control; add + per-row edit + note. In the desktop PM HubNav (รายชื่อติดต่อ) AND the phone bottom-tab bar (ติดต่อ). |

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
