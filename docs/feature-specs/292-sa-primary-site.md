# Spec 292 — SA primary site + project switcher

**Status:** Design drafted 2026-07-10 (SA-audit → feature, session 5). **Investigate + spec only this session — NO build, NO schema, NO migration.** Units U1–U4 below are sized one-per-session TDD; **U1 is schema-lane-gated + operator-held**. The Open decisions at the end must be confirmed before build.
**Related:** spec 274 (super*admin \_View-as-role* — the TS-layer nav-override precedent, `src/lib/auth/effective-role.ts`), spec 273 (SA next-day work board, `/sa/plan`), spec 279 (self-gov onboarding — self-governance doctrine), spec 282/283 (SA site surfaces). The primary-site flag lives on the same `project_members` row `can_see_project` already trusts.

## Problem

Multi-project site admins (SAs) hit a project picker on the store / schedule / ปิดวัน tiles and land on the wrong project's plan, because there is no persisted notion of "the SA's site." Live at HEAD `0c1e423f`:

- `src/app/sa/page.tsx:175` — `const primaryProjectId = projectIds.length === 1 ? projectIds[0]! : null;`. A primary is resolved **only** for a single-project SA. A multi-project SA gets `null`, so `<SaTools primaryProjectId={null} />` renders its tiles pointing at a picker instead of deep-linking.
- `src/app/sa/plan/page.tsx:59` — when there is no valid `?project=`, the plan defaults to `projects[0]!.id`, i.e. the **alphabetically-first project by `code`** (the list is `order("code")`), not the SA's actual site.

The operator wants the project-scoped surfaces to DEFAULT to the SA's primary site, with a switcher to reach their other current projects.

### Locked decisions (operator — do not relitigate)

1. The primary site is **EXPLICIT**: a persisted flag the SA sets self-serve (per self-governance doctrine) and/or a PM sets. It is **not** auto-derived as the source of truth.
2. **Guardrail:** the explicit flag WINS, but when unset, fall back to a **derived default** so a never-configured SA has no cold-start dead-end.
3. Consumers default to the **resolved current project**: `SaTools` store + schedule tiles + `/sa/plan`. Home `/sa` **still AGGREGATES** across projects — do not change the aggregate home.
4. Switcher: a **current-project chip** on `/sa` listing the SA's projects, to switch / see others.

## Investigation findings (LIVE evidence, 2026-07-10)

### Membership model → the flag's home

Queried against the linked prod DB (`supabase db query --linked`):

- **`project_members`** — PK `(project_id, user_id)`; columns `project_id, user_id, added_by, added_at`. **No `is_primary`, no `role`, no `ended_at`/soft-delete.** FK `project_id → projects(id) ON DELETE CASCADE`.
- **`work_package_members`** — `(work_package_id, user_id, added_by, added_at)`: a **finer, WP-level** grain.
- **`users`** — has `department_id` but **no `primary_project_id`** column.
- **`can_see_project(p_project_id)`** (`STABLE SECURITY DEFINER`) for `site_admin` = `exists(project_members row for (p_project_id, auth.uid()))` **OR** `projects.project_lead_id = auth.uid()`. It reads **`project_members`**, not `work_package_members`.

→ An SA "belongs" to a project via an **explicit `project_members` row** (project-level), independent of WP assignment. Both candidate flag-homes are greenfield.

**Decision: flag home = `project_members.is_primary`** (a new boolean on the membership row), **not** `users.primary_project_id`:

1. **Co-located with the membership truth** `can_see_project` already trusts — the resolver reads the same table the RLS gate reads.
2. **Dies with the membership.** `ON DELETE CASCADE` (project deleted) and the PM DELETE policy both remove the row → the primary flag vanishes automatically → **no dangling/stale pointer**. `users.primary_project_id` would _survive_ membership removal (the project still exists) and point at a now-invisible project, forcing every resolver read to add a `can_see_project` guard.
3. **"Exactly one primary per SA" is a clean partial-unique invariant:** `create unique index … on project_members (user_id) where is_primary`.

Trade-off: setting a new primary is a **two-row change** (clear the old, set the new) → must be atomic → wrapped in the DEFINER RPC below, never a bare client UPDATE.

**Edge (minor, acceptable):** a project an SA can see _only_ via `projects.project_lead_id` (no `project_members` row — rare for an SA; the lead is typically a PM) has nowhere to hang `is_primary`. Such a project can be **viewed** via the switcher but not **pinned** as primary; it falls to the derived default.

### Past-project visibility — a SEPARATE question (⚑ FLAGGED)

`can_see_project` has **no time dimension**, and `project_members` has **no soft-delete**. Removing an SA from a project = **DELETE the membership row** (DELETE policy: `project_manager`/`project_director`/`super_admin`) → `can_see_project` returns false → RLS blocks the `projects` SELECT and every downstream read. **There is no "past but readable" state today.**

Therefore:

- This spec scopes the switcher to **currently-visible** projects (current memberships + any led project) — the same RLS **scope** as the `projects` select the plan page already runs (`plan/page.tsx:47–51`), though the resolver needs a wider **projection** (the self-filtered membership annotation — see The resolver).
- **"See PAST projects"** (ended memberships) is a distinct visibility-scope change: it needs the membership model to gain a soft-delete (`ended_at`), `can_see_project` to admit ended memberships **read-only**, plus a PDPA/scoping review. **Out of scope here; recorded as a follow-up** (see Non-goals + Open decisions). It is **not** silently folded in.

### Precedents

- **`src/lib/auth/effective-role.ts` (spec 274)** — the `assumed_role` httpOnly cookie is a **TS-layer nav override**: a pure allowlist module + a `.server` cookie-I/O module, forge-guarded (`realRole === "super_admin"`), re-evaluated every request, granting **no** DB privilege (RLS still resolves on `auth.uid()`). This spec mirrors that shape for the session view-override.
- The two defaults being replaced: `sa/page.tsx:175` and `sa/plan/page.tsx:59` (above).

## Design

Keep **two concepts distinct**:

- **Primary site** — the SA's _persisted_ home project. Source of truth = `project_members.is_primary`; when unset, a deterministic **derived default**.
- **Active (current) project** — what the scoped surfaces render _right now_ = a transient **session view-override** if set, else the primary. In the switcher, "view" sets the override; "pin" persists the primary.

### The resolver (SSOT) — `resolveSaCurrentProject`

A single helper every consumer calls, split like `effective-role.ts`:

- **`src/lib/sa/current-project.ts`** — PURE: `resolveSaCurrentProject({ visibleProjects, overrideProjectId }) → { projectId: string | null; source: "override" | "primary" | "derived" | "none" }`. `visibleProjects` = the RLS-scoped project list, each annotated `{ id, code, isPrimary, addedAt, hasMembership }`. A **lead-only** project (visible via `projects.project_lead_id`, no membership row) has `hasMembership: false`, `addedAt: null`, `isPrimary: false` — viewable, not pinnable.
- **`src/lib/sa/current-project.server.ts`** — reads the `sa_active_project` cookie + the annotated visible list, calls the pure resolver. (Cookie I/O + membership read only.) Exports `SA_ACTIVE_PROJECT_COOKIE`. **Cookie attributes:** session cookie (no `maxAge` — a transient view must not outlive the browser session and shadow the primary), `httpOnly`, `secure`, `SameSite=Lax`, `path=/`. **The membership read must self-filter:** the `project_members` SELECT policy is **role-gated, not own-row** (an SA reads ALL members of visible projects) — the annotation query filters `user_id = auth.uid()` explicitly (`projects` select + self-filtered `project_members` embed), else the annotation picks up other users' rows. (The existing plan-page query selects only `id, code, name` — same RLS scope, different projection; one query does NOT suffice as-is.)

**Precedence (highest first):**

1. **Explicit deep-link — `/sa/plan` only:** a valid, visible `?project=<uuid>` wins for that render (existing behavior — a deep-link is explicit intent). Handled at the plan page _before_ the resolver's default; not part of the pure resolver. **View-only for that render:** a Server Component render cannot set cookies (Next.js — cookie writes happen only in Server Actions / Route Handlers), so a bare shared URL never persists. Coherence with the tiles comes from the plan's project **picker**, which U4 rewires through the view-override action (picking a project persists `sa_active_project`, so plan + tiles then agree — without this, plan-on-X + store-tile-on-Y is the exact wrong-project hazard this spec closes).
2. **Session view-override:** the `sa_active_project` cookie, **iff** it names a currently-visible project (else ignored). _[transient VIEW]_
3. **Explicit primary:** the `isPrimary` project, **iff** still visible. _[persisted]_
4. **Derived default** (cold start): most-recently-added membership — membership rows first by `addedAt` **desc**, then **lead-only rows** (`addedAt: null`) **last**, ties broken by `code` **asc**, then `id` **asc** (a total order over the whole annotated list → fully deterministic, including the null-`addedAt` case). Recommended signal; see Open decision #1 for the today's-plan alternative.
5. **None:** the SA has zero visible projects → `null` → consumers keep their existing empty state (no cold-start dead-end).

**Forge-safety:** an override/primary naming a non-visible project is dropped (validated against the RLS list). The cookie grants no privilege — RLS still gates all data on `auth.uid()`, identical to `assumed_role`.

### The setter — DEFINER RPC `set_primary_project(p_project_id uuid)`

`project_members` has **no UPDATE policy** → an SA cannot RLS-update `is_primary`; and the "exactly one primary" invariant needs clear-old + set-new to be **atomic**. So a `SECURITY DEFINER` RPC (the app's established setter pattern — cf. `record_site_purchase`, `approve_staff_registration`):

- **Gate:** the caller must be a member of `p_project_id` — reject (`42501`) on `not exists(select 1 from project_members where project_id = p_project_id and user_id = auth.uid())`. This is the **self-serve** path (self-governance doctrine). An unbound caller is safe by construction: `auth.uid()` NULL matches no rows → `not exists` → reject. (The coalesce / `is distinct from` self-check trap applies to scalar helper-equality gates like `current_user_role() = 'x'`, **not** to this EXISTS form — do not contort the gate.)
- **Body (clear-then-set, two statements in the function's single transaction):** `update project_members set is_primary = false where user_id = auth.uid() and is_primary;` then `update project_members set is_primary = true where user_id = auth.uid() and project_id = p_project_id;`. **Not a single `set is_primary = (project_id = p_project_id)` UPDATE** — a partial unique index is checked **immediately, per-row**, so one multi-row UPDATE can transiently hold two `is_primary = true` rows (row order is unspecified) and raise a spurious duplicate-key error. Clearing first, then setting, never holds two true rows. The DEFINER function is one implicit transaction, so the pair is atomic; the partial-unique index (`unique (user_id) where is_primary`) is the belt-and-suspenders invariant since this RPC is the sole writer.
- **Grants:** `revoke execute … from public, anon; grant execute … to authenticated`.
- **The pin's server action also CLEARS the `sa_active_project` override cookie.** Precedence puts override above primary, so pinning A while an override still points at B would visibly change nothing (every surface keeps rendering B) — pin means "make this my site now and henceforth," so it clears the transient view in the same action.
- The app relay maps the rejects (`42501` / `P0001`, plus the rare `23505` — two concurrent set calls racing the partial-unique index, e.g. a double-tap) to a friendly Thai message.
- **Accepted edge:** a concurrent membership DELETE between the gate check and the set statement leaves the caller with zero `is_primary` rows (old cleared, new matched nothing). Graceful — the resolver falls to the derived default; no corruption, no error surface needed.
- **PM/PD-sets-for-an-SA** is a _separate_ signature (`set_primary_project_for(p_user_id, p_project_id)`, gated to `project_manager`/`project_director`/`super_admin` sharing the project) — **deferred to U5**; v1 is self-serve. See Open decision #2.

### Consumers

- **`SaTools` tiles** (rendered from `sa/page.tsx`): replace the `primaryProjectId = projectIds.length === 1 ? … : null` prop (line 175) with the resolver's `projectId`. Tiles (store / schedule / ปิดวัน) then deep-link to the current project → **no picker** for a configured or derivable SA. When the resolver returns `null` (no projects), tiles keep today's behavior.
- **`/sa/plan`** (line 59): replace `projects[0]!.id` with precedence `?project=` (valid+visible, view-only for that render) → resolver default. In **U4**, the plan's project picker is rewired through the view-override server action so an active selection persists as `sa_active_project` across surfaces (see Precedence #1 — closes the plan/tiles split-brain).
- **Home `/sa`**: aggregate body **unchanged**. Adds only the switcher chip below.

### Switcher UX (recommended)

- **Current-project chip** on `/sa`, near the top: shows the resolved current project `code + name` (with a subtle marker when the source is an _override_ vs the _primary_). The home content below stays aggregated across all projects — the chip communicates which site the scoped **tiles/plan** point at.
- Tapping the chip opens a **sheet** listing the SA's visible projects (the RLS `projects` select), the primary marked with a pin glyph, the current one highlighted. Each row:
  - **Tap the row → VIEW:** sets the `sa_active_project` cookie (server action) → scoped surfaces re-scope to it; sheet closes.
  - **"ตั้งเป็นไซต์หลัก" (pin) →** calls `set_primary_project` **and clears the override cookie** → persists `is_primary`; becomes the resolved default immediately and going forward. **Shown only on rows with `hasMembership`** — a lead-only row can be viewed, not pinned (the RPC's membership gate would reject it `42501`; don't render an affordance that always errors).
  - A **"กลับไซต์หลัก / ล้างการเลือก"** control clears the override cookie (revert to primary/derived).
- The server action for the cookie lives under `src/app/sa/**` (**not** `src/lib/auth/**`) → code-only, not a danger-path file.

## Units (one-unit-per-session TDD)

Ordered; each independently shippable + verifiable. Schema tag noted.

- **U1 — schema: `is_primary` + `set_primary_project` · SCHEMA, operator-held.**
  Migration: `alter table project_members add column is_primary boolean not null default false`; `create unique index … on project_members (user_id) where is_primary`; `create or replace function set_primary_project(uuid)` (DEFINER, self-membership-gated, **clear-then-set** two-statement body — see The setter) + grants. **RED first — pgTAP:** a member sets → exactly one `is_primary` flips true and all others false (including the switch-from-an-existing-primary case, which the clear-then-set body must survive without a unique-index violation); a non-member is rejected (`42501`); the grant posture holds (`anon` has no EXECUTE, `authenticated` does). `db:types` regen picks up the column. **Schema-lane-gated** (single migration lane — take the next free timestamp at build time, after spec 291-U1's `075600`) and **danger-path** (migration + DEFINER) → operator-merged.

- **U2 — resolver SSOT · code-only (auto-merge), builds AFTER U1 is LIVE.**
  `current-project.ts` (pure resolver) + `current-project.server.ts` (cookie + self-filtered membership reader) + `SA_ACTIVE_PROJECT_COOKIE`. **Sequencing:** the `.server` reader types against `is_primary` from U1's `db:types` — shipping U2 before U1 is live fails typecheck against a nonexistent column, so U2 starts only once U1 is merged + pushed (the pure resolver itself has no DB dependency). **RED first — Vitest:** the full precedence table (override > primary > derived > none; a non-visible override/primary is dropped; the derived order is deterministic under ties **including lead-only null-`addedAt` rows sorting last**; the cookie is validated against the visible list — the forge-check is the one load-bearing line).

- **U3 — consumer wiring · code-only.**
  `sa/page.tsx` computes the resolved id (server reader) → passes to `SaTools`; `plan/page.tsx` default via the resolver (keeping `?project=`). **RED first:** a multi-project SA's tiles/plan default to the primary/derived project, not `projects[0]`. **Real-flow verify** in the browser (dev-preview login) — multi-project SA, zero console errors.

- **U4 — switcher chip + sheet · code-only.**
  Chip on `/sa` + the sheet; the view-override server action (set/clear the cookie); the pin action calling `set_primary_project` + clearing the override; **rewire the plan's project picker through the view-override action** (selection persists across surfaces; a bare `?project=` URL stays view-only). **RED first:** chip renders the resolved project; view sets the cookie + re-scopes; pin calls the RPC **and clears the override**; pin hidden on non-`hasMembership` rows; clear reverts; plan-picker selection persists. **Real-flow verify** in the browser. Home aggregate body **unchanged**. Code-only (a server action calling the RPC is not a danger-path file).

- **U5 — PM sets an SA's primary · deferred / optional (schema + UI).**
  `set_primary_project_for(p_user_id, p_project_id)` + a PM surface. **Only if** the operator wants PM-driven pinning in addition to self-serve (Open decision #2). Flagged, not scheduled.

**Build dependency:** strictly ordered U1 → U2 → U3 → U4 (U2 types against U1's column; U3/U4 consume U2; U4's pin needs U1 live). The schema lane serializes U1.

## Non-goals / out of scope

- **PAST (ended-membership) project visibility** — needs a `project_members` soft-delete + `can_see_project` widening + PDPA review. Follow-up spec.
- **Generalizing primary-site to `project_manager`** or other multi-project roles — **SA-scoped for v1** (PMs have their own multi-project nav).
- **Changing the aggregate `/sa` home body.**
- **PM-sets-for-SA** (unless the operator elects U5).
- **today's-plan as the derived signal** (unless the operator elects it — Open decision #1).
- Any **impersonation / privilege change** — the override is a TS-layer _view_ only, exactly like `assumed_role`; it never alters RLS or `auth.uid()`.

## Open decisions for operator (confirm before build)

1. **Derived fallback signal.** Recommend **most-recently-added membership** (`added_at` desc, deterministic, zero extra subsystem coupling). Alternative: today's `daily_work_plan` project (more behaviorally "where I'm working today," but couples the resolver to the planning subsystem and is often empty). → Confirm most-recent-membership.
2. **Setter authority in v1.** Recommend **self-serve only** (`set_primary_project`, member-gated); defer PM-sets-for-SA to U5. → Confirm, or pull U5 into v1.
3. **"See past projects."** Confirm **OUT of scope** for now (requires a membership soft-delete). If wanted soon, it becomes its own spec.
4. **Role scope.** Confirm primary-site is **`site_admin`-only** for v1.
5. **Chip label under a derived default** (no override, no pinned primary). Recommend showing the **derived project's name** with a subtle "auto" hint (the chip must name whatever the tiles point at). → Confirm.
