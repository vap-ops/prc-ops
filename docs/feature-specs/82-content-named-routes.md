# Spec 82 — content-named route namespace (program)

**Status:** draft — program spec, staged into units (Unit 1 defined below)
**Date:** 2026-06-14
**Origin:** operator 2026-06-14: "site map looks weird, pm lands on sa.
I think the map should be about what is shown on the page, not the role."

## The defect: the URL prefix lies

Route prefixes `/sa` and `/pm` name a **role**. But per the WP-centric
doctrine (spec 59) the surfaces under them are **shared**: `/sa/projects/[id]`
is "THE project page for every role." So a PM who taps a project in
`/pm/projects` lands on `/sa/projects/[id]` — a URL labelled with a role that
is not theirs. The site-map doc already groups by _surface_ (Project / Review /
Purchasing surfaces); only the URLs still group by role. Doc and routes
disagree — that mismatch is the "weird."

`/requests` already proves the target model: a content-named surface, gated by
`PURCHASING_ROLES`, with **no** `/sa` or `/pm` prefix. The project, review,
payroll, and contacts routes are the holdouts, not the rule.

## Principle

**The URL names the surface (what is shown). The role decides which surface a
user LANDS on (`roleHome`) and which chrome/chips render on a shared surface —
never the URL prefix.** A role prefix is justified only when the surface itself
has no role-neutral identity; under this principle, none of ours do.

## Target map (old → new)

| Old route                                                        | New route                                | Gate (unchanged) |
| ---------------------------------------------------------------- | ---------------------------------------- | ---------------- |
| `/sa/projects/[id]`                                              | `/projects/[id]`                         | SITE_STAFF_ROLES |
| `/sa/projects/[id]/work-packages/[wpId]`                         | `/projects/[id]/work-packages/[wpId]`    | SITE_STAFF_ROLES |
| `/sa/projects/[id]/settings`                                     | `/projects/[id]/settings`                | PM_ROLES         |
| `/pm/projects/[id]/reports`                                      | `/projects/[id]/reports`                 | PM_ROLES         |
| `/sa` (SA project hub)                                           | `/projects` (one hub, role-aware chrome) | SITE_STAFF_ROLES |
| `/pm/projects` (PM project hub)                                  | `/projects` (folded into the above)      | SITE_STAFF_ROLES |
| `/pm` (review queue)                                             | `/review`                                | PM_ROLES         |
| `/pm/work-packages/[wpId]` (PM WP review)                        | `/review/work-packages/[wpId]`           | PM_ROLES         |
| `/pm/payroll`                                                    | `/payroll`                               | PM_ROLES         |
| `/pm/contacts`                                                   | `/contacts`                              | PM_ROLES         |
| `/requests`, `/requests/[id]`                                    | unchanged — already content-named ✓      | PURCHASING_ROLES |
| `/workers`, `/profile`, `/coming-soon`, `/login`, `/auth/*`, `/` | unchanged ✓                              | various          |

After the program: `roleHome` → `site_admin: /projects`, `pm/super: /review`,
`procurement: /requests`. `projectHubHref(role)` (the spec-59 role-aware back
target) **collapses to a constant** `/projects` for every site-staff role and is
retired — the bug it patched (PM bounced to `/sa`) becomes structurally
impossible once the hub has one URL.

## Cross-cutting rules (every unit)

1. **Redirects.** Old paths must keep resolving for external deep links
   (bookmarks, and any LINE notification links from the spec-32 outbox). Add
   `redirects()` in `next.config.ts`, `permanent: false` (307) during rollout —
   not 308; an installed PWA caches permanent redirects stickily. Promote to
   `permanent: true` in a cleanup unit once links are confirmed migrated.
2. **Centralize path construction.** Today hrefs are inline template literals
   scattered across pages, actions (`revalidatePath`), and components — that
   scatter is what let a role prefix leak everywhere. Introduce
   `src/lib/nav/project-paths.ts` exporting builders (`projectHref(id)`,
   `workPackageHref(id, wpId)`, `projectSettingsHref(id)`, `reportsHref(id)`,
   …). Every inline string is replaced by a builder call. Unit-tested. Future
   route moves then touch one file.
3. **Doc in the same unit.** `docs/site-map.md` is updated in the unit that
   moves a route (its standing contract). Drop the role framing from its
   route column as routes neutralize.
4. **Gates do not change.** This is a namespace move, not a permissions change.
   `requireRole(...)` arguments stay byte-for-byte identical per route.

## Staging

- **Unit 1 (this spec, below):** neutralize the project detail subtree
  `/sa/projects/*` → `/projects/*`. Fixes the reported bug exactly (PM stops
  landing on a `/sa` URL). Hubs stay role-named for now — honest, they ARE role
  landings; folding them is Unit 3.
- **Unit 2:** `/pm/projects/[id]/reports` → `/projects/[id]/reports`.
- **Unit 3:** fold `/sa` + `/pm/projects` hubs → one `/projects` hub with
  role-conditional `HubNav` items and chips; update `roleHome`, retire
  `projectHubHref`. (This is the "merge the two hub lists" design-round
  candidate recorded in spec 59 and site-map.md.)
- **Unit 4:** rename the remaining role-prefixed surfaces — `/pm` → `/review`,
  `/pm/work-packages` → `/review/work-packages`, `/pm/payroll` → `/payroll`,
  `/pm/contacts` → `/contacts`; `roleHome` pm/super → `/review`.
- **Unit 5 (cleanup):** promote redirects to permanent once link sources
  (notifications, any external bookmarks) are confirmed migrated; remove dead
  redirect rules whose old paths no longer appear anywhere.

Each unit is independently shippable and leaves the app fully working
(redirects cover the not-yet-moved callers). One unit per session per CLAUDE.md.

## Unit 1 — neutralize the project detail subtree

Move the whole `/sa/projects/[projectId]` subtree to `/projects/[projectId]`
(Next nests `work-packages` and `settings` under the same segment, so they move
together as one tree):

- `src/app/sa/projects/[projectId]/` → `src/app/projects/[projectId]/`
  (page, `work-package-list.tsx`, `settings/`, `work-packages/[workPackageId]/`
  with its `page.tsx`, `actions.ts`, `assignment-actions.ts`, `notes-actions.ts`,
  `phase-uploader.tsx`).
- Update all import specifiers that reach into the moved tree:
  `wp-assignment-panel.tsx`, `work-package-notes.tsx`, `upload-queue-runner.tsx`
  (`@/app/sa/projects/...` → `@/app/projects/...`).
- Replace every inline `/sa/projects/...` string — `DetailHeader backHref`,
  `revalidatePath` in the three `actions.ts`, the WP-list row `href`, the
  settings `revalidatePath`s, the SA hub row href (`sa/page.tsx`), the PM hub
  row href (`pm/projects/page.tsx`), and the two `/requests` cross-links
  (`requests/page.tsx`, `requests/[requestId]/page.tsx`) — with calls to the new
  `project-paths.ts` builders.
- `next.config.ts`: add `redirects()` mapping `/sa/projects/:path*` →
  `/projects/:path*` (307).
- `bottom-tab-bar.tsx`: the PM/super โครงการ tab `match: ["/sa"]` highlight rule
  must match the new project surface — update to `["/projects"]` (and keep
  `/sa` matching until the hub itself moves in Unit 3, since the SA tab still
  points at `/sa`).
- **`projectHubHref` stays unchanged in Unit 1** — it returns hub URLs (`/sa`,
  `/pm/projects`), which do not move until Unit 3. The WP-list back chip keeps
  using it.
- `docs/site-map.md`: rewrite the Project-surfaces rows to the `/projects/*`
  URLs; note reports still at `/pm/.../reports` until Unit 2.

### Audit before coding (do not skip)

Grep the spec-32 notification outbox and any report/email templates for
`/sa/projects` links. If notifications embed that path, the 307 redirect covers
old sends, but **new** sends should emit `/projects/*` — fix the template in
this unit. Record the finding either way.

## Tests (failing first)

Per CLAUDE.md, first message of the implementation unit is the failing test.

- `tests/unit/project-paths.test.ts` — the new builders: `projectHref`,
  `workPackageHref`, `projectSettingsHref` produce the `/projects/*` shapes.
  (Write these failing first — the module does not exist yet.)
- `tests/unit/` render assertions: the SA hub row and PM hub row link to
  `projectHref(id)` (i.e. `/projects/[id]`), not `/sa/projects/[id]`.
- `tests/e2e/` (local, CI does not run e2e): navigating to `/projects/[id]`
  renders the project page for an SA and a PM session; old `/sa/projects/[id]`
  307-redirects to the new URL.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm build` green.
2. `pnpm test:e2e` local: `/projects/[id]` renders for SA and PM; `/sa/projects/[id]`
   redirects.
3. Operator round-trip (acceptance): as PM, โครงการ → tap project → URL is
   `/projects/[id]` (no `sa`); WP detail and back chip work; back returns to the
   PM hub. As SA, the same loop works and back returns to `/sa`.
4. No string `"/sa/projects"` remains in `src/` except the `next.config.ts`
   redirect rule.

## Recorded seams / non-goals

- The two project-list hubs (`/sa`, `/pm/projects`) still coexist after Unit 1;
  folding them is Unit 3, not a Unit 1 defect.
- `/pm`, `/pm/payroll`, `/pm/contacts`, `/pm/work-packages` keep their role
  prefix until Unit 4.
- No gate, RLS, or role-enum change anywhere in this program — namespace only.
