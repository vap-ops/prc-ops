# Site map

Audited 2026-06-13 (current through spec 70). Every route, its gate, how
users arrive, and where "back" goes. **Nav changes must update this doc in
the same unit** (same contract as ui-conventions.md).

Principle: the WP list at `/sa/projects/[id]` is THE project page for
every role (WP-centric doctrine). Round-trip rule: entering a detail
surface from a hub, the back affordance returns to that same hub.

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

`roleHome`: site_admin → `/sa` · pm/super → `/pm` · procurement → `/requests`
(spec 70) · others → `/coming-soon`.

## Bottom tabs (phones)

- SA: โครงการ `/sa` · คำขอซื้อ `/requests` · โปรไฟล์ `/profile`
- PM/super: รอตรวจ `/pm` · โครงการ `/pm/projects` (also lights on `/sa/*`)
  · คำขอซื้อ `/requests` · ติดต่อ `/pm/contacts` (spec 81) · โปรไฟล์ `/profile`
- procurement (spec 70): คำขอซื้อ `/requests` · โปรไฟล์ `/profile` (no project
  hub, not a decider)

## Project surfaces

| Route                                                                        | Gate        | Rows / actions →                                                               | Back →                                                                  |
| ---------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `/sa` (SA project hub)                                                       | sa/pm/super | project → `/sa/projects/[id]`                                                  | — (hub)                                                                 |
| `/pm/projects` (PM project hub)                                              | pm/super    | project → `/sa/projects/[id]` (spec 59)                                        | — (hub)                                                                 |
| `/sa/projects/[id]` — **THE project page** (WP list, view filter)            | sa/pm/super | WP → WP detail · รายงาน chip (pm/super) → reports · gear (pm/super) → settings | `projectHubHref(role)`: SA → `/sa`, pm/super → `/pm/projects` (spec 59) |
| `/sa/projects/[id]/work-packages/[id]` — WP detail (photos, requests, labor) | sa/pm/super | photos/requests/labor zones · request card → `/requests/[id]`                  | `/sa/projects/[id]`                                                     |
| `/sa/projects/[id]/settings`                                                 | pm/super    | name/status form (ADR 0042)                                                    | `/sa/projects/[id]`                                                     |
| `/pm/projects/[id]/reports`                                                  | pm/super    | generate/download PDFs                                                         | back chip → `/sa/projects/[id]` (spec 60; the link row is gone)         |

## Review surfaces

| Route                                                                   | Gate     | Rows / actions →                                    | Back →                              |
| ----------------------------------------------------------------------- | -------- | --------------------------------------------------- | ----------------------------------- |
| `/pm` (review queue)                                                    | pm/super | WP → `/pm/work-packages/[id]`                       | — (hub)                             |
| `/pm/work-packages/[id]` — PM WP review (photos, decision, hold toggle) | pm/super | decision form · สร้างคำขอซื้อ → `/requests?wp=`     | `/pm` (queue is the entry)          |
| `/pm/payroll` — DC payroll rollup + CSV export (money, spec 69)         | pm/super | period rollup of DC days by contractor · CSV export | — (desktop PM HubNav ค่าจ้าง entry) |

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

| Route          | Gate     | Notes                                                                                                                                                                                                |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/workers`     | pm/super | labor roster (spec 46). **No nav entry yet** — reachable by URL only; recorded seam.                                                                                                                 |
| `/pm/contacts` | pm/super | contacts management (spec 81): clients / suppliers / contractors via a segmented control; add + per-row edit + note. In the desktop PM HubNav (รายชื่อติดต่อ) AND the phone bottom-tab bar (ติดต่อ). |

## Known seams (recorded, not defects)

- `/sa` and `/pm/projects` are two hub lists with one row behavior;
  merging is a design-round candidate.
- `/workers` nav entry pending its own small spec.
- `/pm/payroll` (ค่าจ้าง) is in the desktop PM HubNav (`hub-nav.tsx`) only — the
  phone bottom-tab bar has no entry for it yet (same gap as `/workers`).
- procurement is onboarded onto the purchasing worklist (spec 70) but has no
  project hub (`projects` SELECT deferred) and no desktop HubNav — recorded
  seams for later units. The `/pm/contacts` supplier screen (spec 81) is
  PM-gated; procurement (a supplier writer at the data layer) does not reach it
  yet — its own widening unit.
- SA quick-adds a contractor inline on WP assignment (spec 31) but does not
  reach `/pm/contacts` to curate contacts — recorded seam.
