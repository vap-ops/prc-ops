# Site map

Audited 2026-06-13 (spec 59). Every route, its gate, how users arrive,
and where "back" goes. **Nav changes must update this doc in the same
unit** (same contract as ui-conventions.md).

Principle: the WP list at `/sa/projects/[id]` is THE project page for
every role (WP-centric doctrine). Round-trip rule: entering a detail
surface from a hub, the back affordance returns to that same hub.

## Entry and auth

| Route                                       | Gate        | Notes                                                  |
| ------------------------------------------- | ----------- | ------------------------------------------------------ |
| `/`                                         | public      | redirects: session → `roleHome(role)`, none → `/login` |
| `/login`                                    | public      | LINE login; standalone PWA uses device-code handoff    |
| `/auth/callback`                            | public      | LINE OAuth return (browser + handoff flows)            |
| `/auth/handoff/start`, `/auth/handoff/poll` | public POST | ADR 0041 device-code handoff                           |
| `/coming-soon`                              | session     | unserved roles' landing (`roleHome`)                   |
| `/profile`                                  | session     | display name, avatar, logout (PWA's logout home)       |

`roleHome`: site_admin → `/sa` · pm/super → `/pm` · others → `/coming-soon`.

## Bottom tabs (phones)

- SA: โครงการ `/sa` · คำขอซื้อ `/requests` · โปรไฟล์ `/profile`
- PM/super: รอตรวจ `/pm` · โครงการ `/pm/projects` (also lights on `/sa/*`)
  · คำขอซื้อ `/requests` · โปรไฟล์ `/profile`

## Project surfaces

| Route                                                                        | Gate        | Rows / actions →                                                               | Back →                                                                  |
| ---------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `/sa` (SA project hub)                                                       | sa/pm/super | project → `/sa/projects/[id]`                                                  | — (hub)                                                                 |
| `/pm/projects` (PM project hub)                                              | pm/super    | project → `/sa/projects/[id]` (spec 59)                                        | — (hub)                                                                 |
| `/sa/projects/[id]` — **THE project page** (WP list, view filter)            | sa/pm/super | WP → WP detail · รายงาน chip (pm/super) → reports · gear (pm/super) → settings | `projectHubHref(role)`: SA → `/sa`, pm/super → `/pm/projects` (spec 59) |
| `/sa/projects/[id]/work-packages/[id]` — WP detail (photos, requests, labor) | sa/pm/super | photos/requests/labor zones · request card → `/requests/[id]`                  | `/sa/projects/[id]`                                                     |
| `/sa/projects/[id]/settings`                                                 | pm/super    | name/status form (ADR 0042)                                                    | `/sa/projects/[id]`                                                     |
| `/pm/projects/[id]/reports`                                                  | pm/super    | generate/download PDFs                                                         | nav row: `/pm` · `/pm/projects` · `/sa/projects/[id]`                   |

## Review surfaces

| Route                                                                   | Gate     | Rows / actions →                                | Back →                     |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------- | -------------------------- |
| `/pm` (review queue)                                                    | pm/super | WP → `/pm/work-packages/[id]`                   | — (hub)                    |
| `/pm/work-packages/[id]` — PM WP review (photos, decision, hold toggle) | pm/super | decision form · สร้างคำขอซื้อ → `/requests?wp=` | `/pm` (queue is the entry) |

## Purchasing surfaces

| Route            | Gate        | Rows / actions →                                        | Back →      |
| ---------------- | ----------- | ------------------------------------------------------- | ----------- |
| `/requests`      | sa/pm/super | card → `/requests/[id]` · create form                   | — (hub/tab) |
| `/requests/[id]` | sa/pm/super | decision/record/ship/cancel zones · WP line → WP detail | `/requests` |

## Other

| Route      | Gate     | Notes                                                                                |
| ---------- | -------- | ------------------------------------------------------------------------------------ |
| `/workers` | pm/super | labor roster (spec 46). **No nav entry yet** — reachable by URL only; recorded seam. |

## Known seams (recorded, not defects)

- `/sa` and `/pm/projects` are two hub lists with one row behavior;
  merging is a design-round candidate.
- `/workers` nav entry pending its own small spec.
- procurement role reaches nothing yet (no projects/requests surface) —
  the procurement-onboarding unit owns its whole map column.
