# Spec 316 — Role-management UX: guided picker + derived capability view

Status: approved (operator, in-chat 2026-07-14)
Units: U1 registry + guards · U2 guided picker + user search · U3 capabilities page
Type: CODE-ONLY (no schema, no `src/lib/auth/**` edits — imports only)

## 1. Problem

Operator verdict: "role management is messy." Verified state:

- `/settings/roles` role picker is a flat `<select>` of all 17 `user_role`
  values, Thai label only, zero explanation of what each role grants
  (`src/components/features/roles/role-admin-list.tsx`).
- Unbuilt roles (`site_owner`, `subcon_manager`, `hr`, `auditor` — anything
  routing to `/coming-soon`) are offered indistinguishably. A wrong pick lands
  the user on a dead screen.
- Who-can-do-what exists only as 28+ hand-composed `*_ROLES` constants in
  `src/lib/auth/role-home.ts` (+ `BILLING_WRITE_ROLES` in
  `src/lib/accounting/billing-actions.ts`) behind ~197 `requireRole` call
  sites — invisible to the operator.
- No user search on the roles page; finding one person means scrolling all
  groups.

Out of scope by operator decision: enum surgery (ADR 0080 phase-2 zombie
cleanup) and the code-side capability-registry inversion (gates keep reading
the hand sets). This spec is the operator-facing layer only.

## 2. Design principle — derive, don't describe

Hand-written role descriptions rot. Everything the UI claims about a role is
**derived from the real code** wherever possible:

| Fact shown            | Source (derived, cannot lie)                         |
| --------------------- | ---------------------------------------------------- |
| Capability membership | the live `*_ROLES` consts (imported, never re-typed) |
| Home screen           | `roleHome(role)`                                     |
| Unbuilt badge         | `roleHome(role) === "/coming-soon"`                  |

Authored-once facts are pinned by exhaustive `Record<UserRole, …>` types and a
coverage guard test, so they can be _stale in wording_ but never _missing_:

| Fact                    | Authored where            |
| ----------------------- | ------------------------- |
| Capability Thai label   | capability registry entry |
| Capability domain group | capability registry entry |
| Role category           | `ROLE_CATEGORY` record    |
| Role one-line summary   | `ROLE_SUMMARY` record     |

## 3. SSOT — `src/lib/roles/role-capabilities.ts` (U1)

```ts
export type RoleCategory = "office" | "field" | "external";

// Exhaustive: adding a user_role enum value without placing it here is a
// TYPE error (house guard pattern, mirrors ROLE_GROUP_ORDER).
export const ROLE_CATEGORY: Record<UserRole, RoleCategory> = { … };

export const ROLE_SUMMARY: Record<UserRole, string> = { … }; // 1 Thai line each

export type CapabilityDomain =
  | "purchasing"   // จัดซื้อ
  | "money"        // เงิน/บัญชี
  | "team"         // ทีมงาน/ค่าแรง
  | "site"         // โครงการ/หน้างาน
  | "documents"    // เอกสาร/กฎหมาย
  | "admin";       // ระบบ/ตั้งค่า

export interface CapabilityEntry {
  key: string;            // e.g. "payroll" — stable, kebab-case
  roles: readonly UserRole[]; // THE imported const from role-home.ts
  labelTh: string;        // e.g. "ดูค่าแรง/จ่ายค่าแรง"
  domain: CapabilityDomain;
}

export const CAPABILITY_REGISTRY: readonly CapabilityEntry[] = [ … ];

export function capabilitiesForRole(role: UserRole): CapabilityEntry[];
export function rolesForCapability(key: string): readonly UserRole[];
export function isUnbuiltRole(role: UserRole): boolean; // roleHome === "/coming-soon"
```

- `roles` fields reference the **imported constants** (`PM_ROLES`,
  `PAYROLL_ROLES`, …). Membership is never re-declared in this file.
- Import direction: `role-capabilities.ts` → `role-home.ts` (one-way; no cycle;
  `role-home.ts` is not edited).
- Registry covers: every exported `*_ROLES` const in `role-home.ts` + the
  exported `BILLING_WRITE_ROLES` from `billing-actions.ts`. Every export gets
  its OWN registry entry; tier/building-block sets (e.g. `PM_ROLES`) get a
  group-style label ("ระดับ…") rather than a feature label. Final Thai labels
  authored in U1, corrected in review.

### Role categories (operator-confirmed)

- **office (สำนักงาน):** super_admin, project_director, project_manager,
  project_coordinator, procurement, procurement_manager, accounting, legal,
  hr, auditor, subcon_manager
- **field (หน้างาน):** site_admin, technician, site_owner
- **external (บุคคลภายนอก):** client, contractor, visitor

### Guard tests (U1, RED first)

1. **Coverage guard:** enumerate `import * as roleHome from
"@/lib/auth/role-home"`, filter exported values that are arrays of
   `UserRole` named `*_ROLES`, assert every one appears as some registry
   entry's `roles` reference (identity or set-equality), plus
   `BILLING_WRITE_ROLES`. New set without a registry entry = red CI.
2. **Registry sanity:** keys unique + kebab-case; labels nonblank Thai;
   every domain used at least once is a valid `CapabilityDomain`.
3. **Category/summary exhaustiveness:** type-level via `Record<UserRole, …>`
   - runtime pin test on value count (mirrors pgTAP enum-pin style so a
     _removed_ entry also fails).

## 4. `/settings/roles` rework (U2)

Existing page keeps: super_admin gate, grouped sections
(`groupUsersByRole`), visitor promotion queue first, count line, per-user
detail link to `/settings/roles/[id]`.

New:

1. **Search box** above the groups — client-side filter on user name
   (Thai `localeCompare`-friendly substring match; list is already fully
   loaded). Empty result → existing `EmptyNotice` pattern. Clearing restores
   groups. Group headers hide when a group filters to zero.
2. **Role-change sheet → 2-step guided picker** (replaces the flat select in
   `role-admin-list.tsx`; stays a `BottomSheet`):
   - **Step 1 — category:** three tiles สำนักงาน · หน้างาน · บุคคลภายนอก.
     The user's current role's category is visually marked.
   - **Step 2 — role list within category:** each row = Thai role name +
     `ROLE_SUMMARY` line. Unbuilt roles (`isUnbuiltRole`) sink to the bottom
     of their category and carry a ⚠ "ยังไม่มีหน้าจอ" badge (assignable but
     warned — not hidden).
   - **Preview card** (expands when a role is selected, same sheet): home
     screen (Thai label of `roleHome` route), capability list grouped by
     domain from `capabilitiesForRole`. Confirm button → existing
     `setUserRole` server action (unchanged; RPC untouched).
   - Back affordance from step 2 → step 1. Sheet close resets to step 1.
3. Link card/row to the new `/settings/roles/capabilities` page
   ("สิทธิ์การใช้งานของแต่ละบทบาท").

No change to `setUserRole` action, RPC, RLS, or the registration-approval
assignment path (follow-up candidate, §7).

## 5. `/settings/roles/capabilities` (U3)

New super_admin page ("สิทธิ์การใช้งาน"), `DetailHeader` back to
`/settings/roles`. Phone-first — **no wide grid**. Two lenses, toggled by a
segmented control:

- **Lens 1 — by role (default):** accordion, one row per role in
  `ROLE_GROUP_ORDER` order, grouped under the three category headers. Expand →
  summary line, home screen, unbuilt badge, capabilities grouped by domain.
- **Lens 2 — by capability:** rows grouped by domain; expand a capability →
  the roles that hold it (Thai labels, category-tinted chips).
- **Search box** filters both lenses: lens 1 matches role names/summaries,
  lens 2 matches capability labels. Client-side; page data is all static
  registry content (Server Component shell + one small client island for
  accordion/search state).

## 6. Build discipline

- TDD per unit; failing test first, stated explicitly.
- Code-only → each PR auto-merges on green (fence rules). No lane conflict:
  schema untouched.
- Known guard trips to update deliberately (see guard-trip map):
  - new `page.tsx` → nav-back-affordance guard classification
    (`/settings/roles/capabilities` = STATIC_DETAIL).
  - settings-sections pin if a settings entry/link shape changes.
  - new components live in existing `src/components/features/roles/` domain
    (no new folder → no structure-guard trip).
- Shared-SSOT overlap with lane 313nav: nav-back guard file. Entries are
  additive; whoever merges second resolves.
- `src/lib/i18n/labels.ts`: new user-facing terms used on 2+ surfaces
  (category names, page title, badge text) go to labels.ts; single-surface
  strings stay local. `labels.ts` is a shared SSOT — flag in LANES while held.

## 7. Follow-ups (explicitly out of scope)

- Nav-tab preview per role (design chat mentioned it; deriving tabs means
  importing `tabsForRole` internals from a chrome component — extract-then-
  derive is its own small unit; v1 preview = home screen + capabilities).
- Reuse the capability preview card in the registration-approval role picker
  (`registration-decision.tsx`).
- Wording-age audit of authored labels (registry makes it one file to sweep).
- Capability registry as the _enforcement_ source (layer-C inversion) —
  registry shape here is deliberately compatible.
- SQL-side DEFINER RPC gates beyond the 3 mirrored predicates (verified
  2026-07-14: live `is_back_office`/`is_manager`/`is_site_staff` match their
  TS sets) — matrix covers screen/action access only.

## 8. Verification checklist

- [ ] U1: guard tests red→green; registry covers all `*_ROLES` exports.
- [ ] U2: search filters/restores; 2-step picker assigns a role end-to-end via
      existing action (browser, dev-preview super_admin); unbuilt badge shows
      for site_owner; visitor queue + grouping unchanged.
- [ ] U3: both lenses render all 17 roles / all registry entries; search works
      in both; zero console errors.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green each unit; fresh-eyes
      review each PR.
