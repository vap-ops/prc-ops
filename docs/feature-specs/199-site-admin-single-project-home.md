# Spec 199 — A single-project site_admin lands on their project

**Why:** operator — "Site admins should default to their respective project page,
they can't normally work on more than 1 project at a time." Today every site_admin
lands on `/sa` (the daily home spanning their work, spec 192 U4). When an SA
belongs to exactly one project, that home is an extra hop — their project page is
their real home.

**Decision:** at the landing points (LINE callback + the homepage redirect), a
site_admin who belongs to **exactly one** project lands on that project
(`/projects/[id]`). With **0 or many** projects they keep `/sa` (the home that
spans their work and explains the empty state). Every other role is unchanged.

`roleHome()` stays a **pure** role→path function (the fallback, still `/sa` for
site_admin) — it has no DB and many call sites pin it. The membership refinement
lives in a new DB-aware resolver used only at the two landing redirects.

## Unit (single)

- `src/lib/auth/resolve-home.ts`:
  - `resolveHomePath(role, projectIds)` — pure. site_admin + exactly one id →
    `projectHref(id)`; otherwise `roleHome(role)`.
  - `homePathForUser(client, role, userId)` — async. Only a site_admin triggers
    the lookup (member ∪ `project_lead_id` = `can_see_project`'s site_admin arm,
    migration 20260728000000); every other role short-circuits to `roleHome` with
    no query. Pass the admin client (a deterministic, RLS-independent lookup by id).
- Wire both redirect sites to `homePathForUser`:
  - the LINE OAuth callback (`src/app/auth/line/callback/route.ts` — `redirectByRole`
    becomes async, fed the admin client + user id);
  - the homepage (`src/app/page.tsx`).
- `/sa` stays the site_admin's bottom-tab home (หน้าหลัก) and the 0/many-project
  landing — only the _default_ landing for a single-project SA changes.

## Out of scope

- No change to `roleHome()` or any other role's landing.
- No change to `/sa` itself (it still spans the SA's projects + empty state).
- The `requireRole` not-allowed fallback keeps `roleHome` (`/sa`) — a forbidden-page
  bounce is not the primary landing.
