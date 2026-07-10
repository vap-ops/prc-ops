# Self-service: own-photo delete + profile employee ID card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `prc-ops:ship-unit` for each
> task (lane claim → dependency gate-check → RED-first → real-flow verify →
> fresh-eyes review → gated ship). Steps use checkbox (`- [ ]`) syntax.
> Spec: `docs/feature-specs/291-self-service-profile-and-photo-delete.md`.

**Goal:** Let a user (1) delete their own progress photos but only before the
work package is submitted for approval, and (2) see their own info on `/profile`
as a compact digital employee ID card showing statuses only (no PDPA values).

**Architecture:** Two independent units. Unit 1 gates the existing
tombstone-delete at three layers (RLS policy — the authority, `removePhoto`
action — the friendly error, UI — hide the affordance) and adds the affordance
to the WP-detail gallery via a small client wrapper (PhaseGallery is a shared
read-only presentational component; the read-only review/procurement callers
must not gain a delete button). Unit 2 enriches the existing `/profile` server
component with RLS-scoped self-reads and a new presentational card component.

**Tech Stack:** Next.js 16 App Router (RSC-by-default), Supabase (Postgres +
RLS), TypeScript strict, Vitest (jsdom) + Testing Library, pgTAP. pnpm.

## Global Constraints

- TDD, RED first: the failing test is written and seen to fail before any
  production code (CLAUDE.md). State "Writing failing test first."
- `photo_logs` is append-only (ADR 0004/0015): a delete is a tombstone row
  (`storage_path NULL`, `superseded_by` set) — never UPDATE/DELETE a row.
- Every table has RLS. DEFINER helpers must `revoke ... from anon` explicitly
  (`from public` is insufficient — see spec 284 lesson).
- Deletable WP statuses = `not_started · in_progress · on_hold · rework`.
  Locked (delete refused) = `pending_approval · complete`.
- Roles come from SSOTs, never hardcoded lists: enum = live `user_role`;
  role sets = `src/lib/auth/role-home.ts`; labels = `USER_ROLE_LABEL` in
  `src/lib/i18n/labels.ts`.
- Never render on `/profile`: `national_id`, `bank_*`, `day_rate`/salary,
  `date_of_birth`, `phone`, `emergency_contact_*`.
- Field-First tokens only (`globals.css`): brand slate `--color-brand`, amber
  `--color-attn`; no raw Tailwind palette, no gradients.
- Ship through `scripts/ship-pr.sh` (never push main). Unit 1 = danger-path
  (migration + RLS) → held for operator merge. Unit 2 = code-only → auto-merge.
- Schema is single-lane: claim the schema lane in `../LANES.md` before writing
  the Unit 1 migration (next number `075570+`, NO borrow).

---

## Unit 1 — Photo self-delete, gated at submit (danger-path, HELD)

Live baseline (gate-checked 2026-07-10):
- `removePhoto` — `src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts:303`.
- `buildTombstoneRow` — `src/lib/photos/tombstone.ts:20`.
- RLS policy `photo_logs insert by sa/pm/super` (INSERT), current `WITH CHECK`:
  ```
  ((SELECT current_user_role()) = ANY (ARRAY['site_admin','project_manager','super_admin','project_director']::user_role[]))
  AND (SELECT can_see_wp(photo_logs.work_package_id))
  AND (uploaded_by = (SELECT auth.uid()))
  ```
- Delete affordance today: only `capture-sheet.tsx:349` (`canDelete`).
- WP-detail `page.tsx` renders `PhaseGallery` at `:476 :487 :502`; `wp.status`
  and `readOnly` are in scope there.

### Task 1: RLS submit-gate — `photo_wp_deletable` helper + tombstone policy (migration + pgTAP)

**Files:**
- Create: `supabase/migrations/<ts>_spec291_photo_delete_submit_gate.sql`
- Create: `supabase/tests/database/<NN>-photo-delete-submit-gate.test.sql`

**Interfaces:**
- Produces: SQL fn `public.photo_wp_deletable(p_wp uuid) returns boolean`
  (`security definer`, `set search_path = public`, revoked from anon) = true
  when the WP's `status NOT IN ('pending_approval','complete')`.
- Produces: altered `WITH CHECK` on policy `photo_logs insert by sa/pm/super`
  adding conjunct `AND (superseded_by IS NULL OR photo_wp_deletable(work_package_id))`.

- [ ] **Step 1 — claim the schema lane.** In `../LANES.md`, under the spec-291
  lane, note "SCHEMA LANE CLAIMED (U1)"; confirm no other active schema lane.
  Pick the next migration timestamp per the `075570+` rule (read the last file
  in `supabase/migrations/`).

- [ ] **Step 2 — write the failing pgTAP test.** In the new
  `supabase/tests/database/<NN>-photo-delete-submit-gate.test.sql`, standard
  pgTAP form (`begin; select plan(N); … finish(); rollback;`). Assertions
  (set role to a site_admin who owns a WP + a photo via test fixtures, or use
  an existing seeded WP per the repo's pgTAP fixture idiom — gate-check an
  existing `photo_logs` test for the fixture pattern first):
  - `photo_wp_deletable` returns true for an `in_progress`/`rework` WP, false
    for `pending_approval`/`complete`.
  - As the uploader, a tombstone insert (`superseded_by` set) on an
    `in_progress` WP **succeeds**; on a `pending_approval` WP it is **rejected**
    (RLS `WITH CHECK`).
  - A normal photo insert (`superseded_by NULL`) is unaffected by the new
    conjunct.

- [ ] **Step 3 — run it, see it fail.** `pnpm db:test` (or the single-file
  path). Expected: the new file fails (fn missing / tombstone not yet gated).

- [ ] **Step 4 — write the migration.** UTF-8 no-BOM. Contents:
  ```sql
  create or replace function public.photo_wp_deletable(p_wp uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select coalesce(
      (select status not in ('pending_approval','complete')
         from public.work_packages where id = p_wp),
      false);
  $$;
  revoke all on function public.photo_wp_deletable(uuid) from public, anon;
  grant execute on function public.photo_wp_deletable(uuid) to authenticated;

  alter policy "photo_logs insert by sa/pm/super" on public.photo_logs
  with check (
    ((select current_user_role()) = any (array['site_admin','project_manager','super_admin','project_director']::user_role[]))
    and (select can_see_wp(photo_logs.work_package_id))
    and (uploaded_by = (select auth.uid()))
    and (superseded_by is null or public.photo_wp_deletable(work_package_id))
  );
  ```
  (`coalesce(..., false)` = the RLS self-check coalesce trap guard — a missing
  WP must fail closed, not open.)

- [ ] **Step 5 — apply + regenerate types.** `pnpm db:push` then `pnpm db:types`;
  `git diff src/lib/db/database.types.ts` — expect only the new function (grep
  for other sessions' object names before committing).

- [ ] **Step 6 — run pgTAP green.** `pnpm db:test` — the new file passes; the
  only reds are the known `200-store`(3) + `221-catalog`(1).

- [ ] **Step 7 — commit.** `git add supabase/migrations/<ts>_*.sql supabase/tests/database/<NN>-*.sql src/lib/db/database.types.ts` then
  `git commit -m "feat(photos): RLS gate — tombstone delete only before submit (spec 291 U1)"`.

### Task 2: `removePhoto` status check (friendly error)

**Files:**
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts` (`removePhoto`, ~:303–362)
- Test: `tests/unit/` (gate-check for an existing `removePhoto`/actions test to extend; else create `tests/unit/remove-photo-submit-gate.test.ts`)

**Interfaces:**
- Consumes: nothing new. Produces: `removePhoto` returns
  `{ ok: false, error: "งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้" }` when the target
  photo's WP `status ∈ {pending_approval, complete}`.

- [ ] **Step 1 — failing test.** Mock the supabase client so the target photo's
  WP status read returns `pending_approval`; assert `removePhoto` returns
  `ok:false` with the submit-gate error and inserts **no** tombstone. (Gate-check
  the existing action-test mock idiom in the repo first.)
- [ ] **Step 2 — run, see fail.** `pnpm exec vitest run <file>` — FAIL.
- [ ] **Step 3 — implement.** In `removePhoto`, the target select already loads
  the WP id; extend it to read the WP status (add a `work_packages` status read
  by `target.work_package_id`, or widen the existing WP read at :352 to run
  before the insert) and return the error before `buildTombstoneRow` when status
  is locked. RLS remains the backstop.
- [ ] **Step 4 — run green.** `pnpm exec vitest run <file>` — PASS.
- [ ] **Step 5 — commit.** `feat(photos): removePhoto refuses after submit (spec 291 U1)`.

### Task 3: hide the capture-sheet delete once submitted

**Files:**
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/capture-sheet.tsx` (~:349, the `canDelete` prop)
- Test: the capture-sheet unit test (`tests/unit/capture-sheet.test.tsx`)

**Interfaces:**
- Consumes: the WP `status` (gate-check how capture-sheet receives it — thread
  it from the WP-detail page if not already a prop). Produces: `canDelete` is
  passed only when `status ∈ deletable set`.

- [ ] **Step 1 — failing test.** Render capture-sheet with `status="pending_approval"`;
  assert no delete affordance (`ลบรูป` absent from the opened lightbox); with
  `status="in_progress"` assert it is present. RED.
- [ ] **Step 2 — run, see fail.** FAIL.
- [ ] **Step 3 — implement.** Define `const WP_PHOTO_DELETABLE = (s) => !["pending_approval","complete"].includes(s)`
  in a shared spot (`src/lib/photos/` — reuse in Task 4 + Task 2), thread the WP
  status into capture-sheet, pass `canDelete={... && WP_PHOTO_DELETABLE(status)}`.
- [ ] **Step 4 — run green.** PASS.
- [ ] **Step 5 — commit.** `feat(photos): hide capture-sheet delete after submit (spec 291 U1)`.

### Task 4: WP-detail gallery own-photo delete (client wrapper)

**Files:**
- Create: `src/components/features/photos/deletable-phase-gallery.tsx` (`"use client"`)
- Modify: `src/components/features/photos/phase-gallery.tsx` (optional per-photo delete props, default off)
- Modify: WP-detail `page.tsx` (render the client wrapper for the site-staff, non-readOnly, deletable-status case)
- Test: `tests/unit/deletable-phase-gallery.test.tsx`

**Interfaces:**
- `PhaseGallery` gains optional props: `currentUserId?: string`,
  `onDeletePhoto?: (photoId: string) => void`, `deletingPhotoId?: string | null`.
  For each photo it passes `canDelete`/`onDeletePhoto` to `ZoomablePhoto` **only**
  when `onDeletePhoto` is set AND `photo.uploaded_by === currentUserId`. Absent
  props → today's read-only behaviour (review/procurement unaffected).
- `DeletablePhaseGallery` (client): same serializable props as PhaseGallery +
  `currentUserId`, `projectId`, `workPackageId`; owns optimistic `deletingPhotoId`
  state and calls the existing `removePhoto` server action, then `router.refresh()`.

- [ ] **Step 1 — failing test.** Render `DeletablePhaseGallery` with two photos
  (one `uploaded_by = me`, one not) on a deletable WP; assert a delete affordance
  appears only for the own photo; confirming a delete calls `removePhoto` with
  that id. On a locked WP status, no delete on either. RED.
- [ ] **Step 2 — run, see fail.** FAIL.
- [ ] **Step 3 — implement** the optional PhaseGallery props + the client
  wrapper (reuse `removePhoto`; supersede semantics unchanged, per
  `prc-ops:supersede-pattern`).
- [ ] **Step 4 — run green** + `pnpm lint && pnpm typecheck`.
- [ ] **Step 5 — wire WP-detail page.** Replace the site-staff, non-`readOnly`
  PhaseGallery renders (:476/:487/:502) with `DeletablePhaseGallery` when
  `WP_PHOTO_DELETABLE(wp.status)` (read the current user id on the page — gate-check
  whether `page.tsx` already has it via `requireRole`/`getClaims`; thread it in).
  Keep read-only surfaces (`readOnly` true, and the /review + procurement callers)
  on plain `PhaseGallery`.
- [ ] **Step 6 — real-flow verify** (dev-preview login): on an `in_progress` WP,
  the uploader sees delete on their own gallery photo and it tombstones; on a
  `pending_approval` WP, no delete; a non-uploader sees none. Zero console errors.
- [ ] **Step 7 — commit.** `feat(photos): own-photo delete on the WP-detail gallery, pre-submit (spec 291 U1)`.

- [ ] **Ship Unit 1** via `scripts/ship-pr.sh` — danger-path (migration+RLS) →
  the PR is HELD; flag the operator to merge (they pre-approved B1).

---

## Unit 2 — Profile → digital employee ID card (code-only, auto-merge)

Live baseline (gate-checked 2026-07-10): `/profile` (`src/app/profile/page.tsx`)
reads `users(role, full_name, line_avatar_url)` via `getClaims().sub`, renders
`AvatarSurface` + `DisplayNameForm` + `LogoutButton`. No employee/external role
set exists in `role-home.ts`. Person data lives in `staff_registrations`,
`crew_registrations`, `workers` (all `user_id`-owned, RLS self-read via the
`own-registration.ts` idiom), consents in `staff_consents` /
`contractor_consents` (`consented_at`/`revoked_at`).

### Task 5: `EXTERNAL_ROLES` set + `isEmployeeRole` helper

**Files:**
- Modify: `src/lib/auth/role-home.ts`
- Test: gate-check for a `role-home` test; else `tests/unit/employee-role.test.ts`

**Interfaces:**
- Produces: `export const EXTERNAL_ROLES: ReadonlyArray<UserRole> = ["client","contractor","visitor"]`
  and `export function isEmployeeRole(r: UserRole): boolean { return !EXTERNAL_ROLES.includes(r); }`.

- [ ] **Step 1 — gate-check the enum.** `select unnest(enum_range(null::public.user_role))`
  — confirm the external set is exactly `client, contractor, visitor` (adjust if
  the enum has another external-facing role; classify deliberately).
- [ ] **Step 2 — failing test.** `isEmployeeRole("site_admin")===true`,
  `isEmployeeRole("client")===false`, `("contractor")===false`, `("visitor")===false`. RED.
- [ ] **Step 3 — run, see fail; Step 4 — implement; Step 5 — run green.**
- [ ] **Step 6 — commit.** `feat(auth): EXTERNAL_ROLES + isEmployeeRole (spec 291 U2)`.

### Task 6: profile self-read loader (statuses only)

**Files:**
- Create: `src/lib/profile/load-profile-card.ts`
- Test: `tests/unit/load-profile-card.test.ts`

**Interfaces:**
- Produces: `loadProfileCard(supabase, userId): Promise<ProfileCard>` where
  ```ts
  interface ProfileCard {
    fullName: string | null; role: UserRole; avatarUrl: string | null;
    departmentName: string | null; employeeId: string | null;
    registration: { status: "pending" | "approved" | "rejected" } | null;
    pdpaConsent: { status: "given" | "revoked"; at: string } | null;
  }
  ```
  All reads are RLS-scoped (the passed `supabase` server client, NOT admin).
  It selects: `users.department_id → departments.name`; `employee_id` +
  `status` from the user's `staff_registrations` (fallback `crew_registrations`);
  the latest consent row's `consented_at`/`revoked_at`. **No** sensitive column
  is selected — the query lists only the allowed columns.

- [ ] **Step 1 — failing tests** (mock supabase): returns department name +
  employee id + registration status when rows exist; `registration:null` /
  `pdpaConsent:null` when they don't; asserts the select strings contain none
  of `national_id|bank|day_rate|date_of_birth|phone|emergency`. RED.
- [ ] **Step 2 fail; Step 3 implement; Step 4 green** + lint/typecheck.
- [ ] **Step 5 — commit.** `feat(profile): RLS self-read loader for the ID card (spec 291 U2)`.

### Task 7: `EmployeeIdCard` presentational component

**Files:**
- Create: `src/components/features/profile/employee-id-card.tsx`
- Test: `tests/unit/employee-id-card.test.tsx`

**Interfaces:**
- Consumes: `ProfileCard` (Task 6) + `USER_ROLE_LABEL`. Produces a compact card:
  slate header (`--color-brand`) + amber accent (`--color-attn`), avatar/initials,
  name, role label, department, employee-ID pill, status pills (registration +
  PDPA). States: `approved`/no-registration → issued; `pending` → provisional
  (muted, no ID pill needed); `rejected` → a message, no card. No live QR.

- [ ] **Step 1 — failing tests** for each state (issued / provisional / rejected)
  asserting: right pills render; role label from `USER_ROLE_LABEL`; **no** PDPA
  string ever in the DOM (assert absence of a national-id/bank/phone fixture value
  passed as a guard prop that must be ignored — or assert the component's props
  type simply has no such field). RED.
- [ ] **Step 2 fail; Step 3 implement** (Field-First tokens, sentence-case Thai);
  **Step 4 green** + lint/typecheck.
- [ ] **Step 5 — commit.** `feat(profile): EmployeeIdCard component (spec 291 U2)`.

### Task 8: wire the card into `/profile`

**Files:**
- Modify: `src/app/profile/page.tsx`
- Test: `tests/unit/` route-level render (extend if a profile-page test exists)

**Interfaces:** consumes Task 5/6/7. Renders `EmployeeIdCard` for
`isEmployeeRole(role)`; external roles keep the plain header + statuses (no card).

- [ ] **Step 1 — failing test.** Render `/profile` for an employee role → card
  present; for `client` → no employee card, plain profile. RED.
- [ ] **Step 2 fail; Step 3 implement.** Call `loadProfileCard(supabase, userId)`
  after the existing `users` read; render `<EmployeeIdCard>` when
  `isEmployeeRole(role)`, above `DisplayNameForm`. Keep `DisplayNameForm` +
  `LogoutButton`.
- [ ] **Step 4 green** + lint/typecheck + full `pnpm test`.
- [ ] **Step 5 — real-flow verify** (dev-preview login, phone width): `/profile`
  shows the card with statuses, no PDPA values; view-as an external role → no
  card. Zero console errors; screenshot.
- [ ] **Step 6 — commit.** `feat(profile): render the employee ID card on /profile (spec 291 U2)`.

- [ ] **Ship Unit 2** via `scripts/ship-pr.sh` — code-only → auto-merges on green.

---

## Self-review (plan vs spec)

- Spec U1 (RLS + action + UI, capture-sheet + WP gallery, own + before-submit) →
  Tasks 1–4. ✓  Spec U2 (card, statuses only, employees only, no PDPA) →
  Tasks 5–8. ✓
- Deferred (QR, photo-forward) → not in any task. ✓
- Shared helper `WP_PHOTO_DELETABLE` defined once (Task 3), reused (Tasks 2, 4) —
  consistent name. ✓  `ProfileCard`/`loadProfileCard`/`isEmployeeRole`/
  `EmployeeIdCard` names consistent across Tasks 5–8. ✓
- Open gate-checks the implementer MUST do (flagged inline, not placeholders):
  the pgTAP fixture idiom (Task 1.2), the action-test mock idiom (Task 2.1),
  how capture-sheet + WP-detail receive `status`/`currentUserId` (Tasks 3, 4).
