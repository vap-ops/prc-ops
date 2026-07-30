# Spec 376 — On-site nav redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task ALSO runs the house `ship-unit` skill gates (fresh-eyes review, full suite, ship-pr.sh).

**Goal:** Ship spec 376's five units — SA โครงการ tab direct-resolve, project-hub คลังหน้างาน cluster, technician 3-tab bar + `/technician/history`, shared-phone register interstitial, site_owner landing.

**Architecture:** All code-only, no schema. U1 is a pure client-side href resolver (no constant/guard rework, redirect stays as fallback). U3 splits one overgrown page along the money/identity boundary. U5 reuses the existing `/projects` redirect machinery by widening its role predicate.

**Tech Stack:** Next.js App Router (RSC + client islands) · vitest + RTL · house nav guards.

**Plan date / HEAD:** 2026-07-30, gate-checked against `origin/main` `62d34bee` (0.273.0). Re-gate-check any task started after other nav lanes merge — this plan is a snapshot (the 313-plan lesson: wrong three times by drift).

## Global Constraints (apply to every task)

- **TDD, RED first**: write the failing test, RUN it, see the named failure, then implement. Mutation-check every source-text assertion (commit FIRST, then mutate → red → restore → `git status` + grep the restored line — the tripled `git checkout --` lesson; pre-flight `git status --porcelain -- <paths>` before EVERY mutation batch).
- **`cd /d/claude/projects/prc-ops/prc-ops-376nav && ` is the literal first token of every command.** Fresh worktree already has `.temp`? NO — it does not; db queries run from the MAIN repo. This plan needs no db queries at build time.
- **Full suite before ship**: `pnpm typecheck && pnpm lint && pnpm test` (vitest ~6,100 tests; flakes under load → re-run the same commit before diagnosing). `pnpm db:test` once per session even code-only (known red = 221-catalog ONLY). Capture full logs to a file, never filtered pipes.
- **`labels.ts` is a shared SSOT — additive edits only, serialize with any live lane touching it** (LANES check before each task ships).
- **Shared constants/helpers used by both server and client live in leaf modules — no `server-only`, no DB imports** (the #817 RSC-boundary lesson; jsdom cannot catch it — `pnpm build` can).
- **Every nav change updates its guards deliberately, never weakens**: `tests/unit/nav-law-strip-superset.test.ts` (auto-derives over `ROLE_GROUP_ORDER` — new role arms get covered the moment both resolvers return non-null), `tests/unit/nav-back-affordance.test.ts` (every `page.tsx` classified), `docs/site-map.md` rows, `bottom-tab-bar.test.tsx` / `hub-nav.test.tsx` pins.
- **New component folders trip `feature-components-structure`** — check the allowlist before creating a folder.
- Thai copy: write via Edit/Write tools only (PowerShell corrupts it). Any user-instructing prose gate-checks against the rendered component, not memory.
- Commits: house conventional style; ship each task via `scripts/ship-pr.sh` (auto-merge on green; danger-path tasks wait for operator).

---

### Task 1 (U1): SA โครงการ tab direct-resolve

**Files:**
- Create: `src/lib/nav/projects-tab-target.ts`
- Create: `tests/unit/projects-tab-target.test.ts`
- Modify: `src/components/features/chrome/bottom-tab-bar.tsx` (BottomTabBar body + props)
- Modify: `src/app/sa/page.tsx` (pass `projectsTabHref`)
- Modify: `tests/unit/bottom-tab-bar.test.tsx` (or the file's existing test home — locate with `grep -rl "BottomTabBar" tests/`)

**Interfaces:**
- Produces: `saProjectsTabHref(args: { role: string; pathname: string; projectsTabHref?: string | null }): string | null` — returns the swap target for the โครงการ tab, or null (= keep static `/projects`). Task 5 reuses NOTHING from here (different mechanism); Task 3 touches the same two chrome files → **Task 1 ships before Task 3 starts**.

**Design (locked at plan time):**
- The `SA_TABS` constant is UNTOUCHED — static href `/projects` stays, so every existing guard/pin holds. The swap happens at render inside `BottomTabBar`.
- Precedence: explicit `projectsTabHref` prop (only `/sa` passes it, from the already-resolved `saCurrent`) → pathname-derived project root (`/projects/<uuid>/...` → `/projects/<uuid>`; the tab is "top of the section you are in") → null (static `/projects`, today's redirect handles it). Non-SA roles: always null.
- When swapped, the rendered tab keeps lighting correctly: its href `/projects/:id` wins longest-prefix on project pages; add `"/projects"` to the rendered item's match so `/projects?view=all` still lights it.
- HubNav (desktop strip) deliberately NOT changed — desktop SA traffic is negligible; the redirect covers it. Recorded as a plan decision, not an omission.

- [ ] **Step 1: Write the failing helper test**

```ts
// tests/unit/projects-tab-target.test.ts
import { describe, expect, it } from "vitest";
import { saProjectsTabHref } from "@/lib/nav/projects-tab-target";

const UUID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

describe("saProjectsTabHref", () => {
  it("prefers the explicit prop (the /sa mount)", () => {
    expect(
      saProjectsTabHref({ role: "site_admin", pathname: "/sa", projectsTabHref: `/projects/${UUID}` }),
    ).toBe(`/projects/${UUID}`);
  });

  it("derives the project root from a project-world pathname", () => {
    expect(
      saProjectsTabHref({ role: "site_admin", pathname: `/projects/${UUID}/work-packages/${UUID}` }),
    ).toBe(`/projects/${UUID}`);
  });

  it("returns null on the hub itself (bare /projects, incl. ?view=all pathname)", () => {
    expect(saProjectsTabHref({ role: "site_admin", pathname: "/projects" })).toBeNull();
  });

  it("returns null for every non-SA role even with a prop", () => {
    expect(
      saProjectsTabHref({ role: "project_manager", pathname: `/projects/${UUID}`, projectsTabHref: `/projects/${UUID}` }),
    ).toBeNull();
  });

  it("returns null off the project world with no prop", () => {
    expect(saProjectsTabHref({ role: "site_admin", pathname: "/team" })).toBeNull();
  });

  it("does not swap on a malformed id segment", () => {
    expect(saProjectsTabHref({ role: "site_admin", pathname: "/projects/not-a-uuid" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

Run: `cd /d/claude/projects/prc-ops/prc-ops-376nav && PATH="/c/Program Files/nodejs:$PATH" pnpm vitest run tests/unit/projects-tab-target.test.ts`
Expected: FAIL — cannot resolve `@/lib/nav/projects-tab-target`.

- [ ] **Step 3: Implement the helper (leaf module — NO `server-only`, no DB imports)**

```ts
// src/lib/nav/projects-tab-target.ts — spec 376 U1.
// The SA's โครงการ tab resolves straight to the project she is in (or, from /sa,
// the resolved current project) instead of paying the /projects RSC-redirect hop
// — which also double-logs telemetry (one tap = two route_views, the refuted-#846
// artifact). SA_TABS stays static; this only swaps the RENDERED href, so the
// /projects redirect remains the fallback for every unresolved case.
const PROJECT_ROOT_RE = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/;

export function saProjectsTabHref(args: {
  role: string;
  pathname: string;
  projectsTabHref?: string | null;
}): string | null {
  if (args.role !== "site_admin") return null;
  if (args.projectsTabHref) return args.projectsTabHref;
  const m = PROJECT_ROOT_RE.exec(args.pathname);
  return m ? `/projects/${m[1]}` : null;
}
```

- [ ] **Step 4: Run the test — expect PASS. Commit** (`feat(nav): sa projects-tab target resolver (spec 376 U1)`).

- [ ] **Step 5: RED test for the bar integration** — in the bar's existing test file add: rendering `BottomTabBar` with `role="site_admin"`, `projectsTabHref` prop, pathname mocked to `/sa` (the file already mocks `usePathname` — follow its pattern) → the โครงการ link's href is the resolved target; with `role="project_manager"` + same prop → href stays `/projects`; with no prop on `/projects/<uuid>/...` pathname → href is the project root. Run, see it fail on the missing prop.

- [ ] **Step 6: Integrate in `bottom-tab-bar.tsx`**

```tsx
export function BottomTabBar({ role, projectsTabHref }: { role: string; projectsTabHref?: string | null }) {
  const pathname = usePathname();
  const tabs = tabsForRole(role);
  if (!tabs) return null;
  // Spec 376 U1 — see projects-tab-target.ts. Swap is render-only; the constant
  // (and every guard pinned to it) is untouched.
  const saTarget = saProjectsTabHref({ role, pathname, projectsTabHref });
  const renderTabs = saTarget
    ? tabs.map((t) =>
        t.href === "/projects" ? { ...t, href: saTarget, match: [...(t.match ?? []), "/projects"] } : t,
      )
    : tabs;
  // ... existing active-tab loop + render now iterate renderTabs ...
```

Keep the active-loop/render body otherwise byte-identical (it iterates `renderTabs`). ⚠️ The `showPurchaseBadge`/`showReworkBadge` checks key on `tab.href` literals (`/requests`, `/sa`) — unaffected by the swap; confirm by reading, not assuming.

- [ ] **Step 7: Run bar tests + helper tests — PASS. Mutation-check**: revert the `renderTabs` swap by hand (use `tabs` directly) → the Step-5 cases must RED with a real run count; restore; `git status` + grep `saProjectsTabHref` present ×2+ in the file.

- [ ] **Step 8: Thread the `/sa` mount.** In `src/app/sa/page.tsx` locate the resolved current project (the custody-pair/store door already needs it — grep `getSaCurrentProject` / `projectHref`). Pass `projectsTabHref={currentProjectId ? projectHref(currentProjectId) : undefined}` to `<BottomTabBar role={ctx.role} … />`. If `/sa` turns out NOT to resolve it at HEAD, add the `getSaCurrentProject` call per its docstring (one read, already batched pattern) — do NOT skip the prop.

- [ ] **Step 9: Source-pin the mount** (comments stripped, ≥2 occurrences of `projectsTabHref` in `sa/page.tsx` — import-line trick doesn't apply to a prop, but pin the EXACT count) in the existing sa-page test file. Mutation-check: delete the prop → red.

- [ ] **Step 10: Full gates + ship.** `pnpm typecheck && pnpm lint && pnpm test > ../t1.log 2>&1` (grep `✕|×|FAIL` afterwards) · `pnpm build` (RSC boundary proof) · browser: view-as site_admin, on `/sa` the โครงการ tab href points at the project hub (read the DOM anchor), tap → hub renders, NO intermediate `/projects` route_view; on `/projects?view=all` the tab still lights. Commit → `bash scripts/ship-pr.sh "feat(nav): SA โครงการ tab resolves direct to her project (spec 376 U1)"`. Code-only → auto-merge on green.

---

### Task 2 (U2): project-hub คลังหน้างาน cluster

**Files:**
- Create: `src/components/features/projects/store-cluster.tsx` (⚠️ check `src/components/features/projects/` exists first; if the folder is new, add it to the `feature-components-structure` allowlist in the same commit)
- Create: `tests/unit/store-cluster.test.tsx`
- Modify: `src/app/projects/[projectId]/page.tsx` (mount cluster in body; RETIRE the two header icon chips it replaces)
- Modify: `src/lib/i18n/labels.ts` (additive: `STORE_CLUSTER_HEADING = "คลังหน้างาน"` — ⚠️ check collisions: `STORE_LABEL = "คลัง"`, `STORE_INCOMING_HEADING`, and spec 375 U3's `เบิกจากคลังหน้างาน` on /sa are DIFFERENT strings; reuse the existing constants inside the cluster, never re-literal them)

**Interfaces:**
- Consumes: `incomingHref(projectId)`, `storeHref(projectId)` from `@/lib/nav/project-paths`; `canSeeStore` gate already computed in the hub page (existing predicate — D1 forward-compat: gate through it, no inline role literal).
- Produces: `<StoreCluster projectId />` — self-contained server-renderable section.

**Design (locked):** one labeled section in the hub body — heading `คลังหน้างาน`, two 44px labeled door tiles: `STORE_INCOMING_HEADING` → `incomingHref` (receiving — 153 views/14d, the storekeeper's real work, listed FIRST) and `STORE_LABEL` → `storeHref` (on-hand + equipment + count). The two icon-only chips for the same destinations in the `DetailHeader` actions row are REMOVED in the same commit — one door per destination per surface (the 313-U3 rule; keeping both is the exact duplicate-door defect). Placement: after the muster/plan quick-action block, before the `#work-packages` section heading. เบิก stays on `/sa` (375 U3) — the cluster is destinations, not actions.

- [ ] **Step 1: RED tests** — RTL render of `StoreCluster`: heading rendered from the labels constant (assert the rendered text AND that the component imports the constant — exact occurrence counts); both doors present with correct hrefs; 44px min-height class on tiles. Run → fail (no component).
- [ ] **Step 2: Implement `StoreCluster`** (plain server component, house tile classes — copy the tile pattern from the custody pair `src/components/features/sa/` shipped in #848, NOT hand-rolled CSS).
- [ ] **Step 3: RED page pins** — in the hub page's test home (grep `projects/[projectId]` under `tests/`): source scan, comments stripped — `StoreCluster` ≥2 occurrences (import + mount); ABSENCE of `incomingHref` / `storeHref` inside the `DetailHeader` actions block (pin the removal — e.g. assert exact occurrence counts of each href helper in the file: they must appear only via the cluster mount's props or not at all, decide from the real file shape at build). Run → fail.
- [ ] **Step 4: Mount + retire chips** in the hub page, gated `{canSeeStore ? <StoreCluster projectId={project.id} /> : null}`. Run pins → PASS.
- [ ] **Step 5: Mutation-checks** (commit first): ① delete the mount → page pin reds; ② re-add one retired icon chip → absence pin reds. Restore, verify.
- [ ] **Step 6: Gates + ship.** Full suite + build; browser view-as site_admin on the project hub: cluster renders, header no longer shows the two chips, both doors navigate. `ship-pr.sh "feat(projects): คลังหน้างาน cluster on the project hub (spec 376 U2)"`.

---

### Task 3 (U3): technician tab bar + `/technician/history`

**Serialize: after Task 1 merges (same chrome files).**

**Files:**
- Modify: `src/components/features/chrome/bottom-tab-bar.tsx` (`TECHNICIAN_TABS` + `tabsForRole` arm)
- Modify: `src/components/features/chrome/hub-nav.tsx` (`TECHNICIAN_HUB_NAV` + `hubNavForRole` arm)
- Create: `src/app/technician/history/page.tsx`
- Create: `src/components/features/portal/worker-history-sections.tsx`
- Modify: `src/components/features/portal/worker-portal-sections.tsx` (slim to identity half)
- Modify: `src/app/technician/page.tsx` (QR-first reorder, chrome mount, drop moved sections)
- Modify: `tests/unit/nav-back-affordance.test.ts` (`technician/history` → NON_DETAIL)
- Modify: `docs/site-map.md` (+ row), existing bar/strip test pins

**Interfaces:**
- Produces: `TECHNICIAN_TABS: ReadonlyArray<TabItem>` = `[ {หน้าหลัก, /technician, Home}, {ประวัติ, /technician/history, Clock}, {โปรไฟล์, /profile, <user icon per house set>} ]`; `TECHNICIAN_HUB_NAV` mirrors all three (nav-law rule 2 — the derived guard picks technician up AUTOMATICALLY the moment both arms return non-null; run it early to watch it bite).
- `WorkerHistorySections({ uid, wp, payments, receipts, hasPendingBank, bankExempt })` — the money half (รายการรอรับ → ประวัติค่าแรง → bank). `WorkerPortalSections` keeps `{ uid, wp, consents }` — the identity half (ข้อมูลของฉัน contact + consents). Split the props accordingly; the type shapes come from the CURRENT component — copy them, don't invent.

**Design (locked):**
- หน้าหลัก `/technician` order: header → notices → `WorkerBadgeQr` (FIRST — the daily physical artifact) → `AssignedWorkCard` → `EmployeeCard` → `WorkerIdCardUpdate` → slim `WorkerPortalSections` (contact + consents).
- ประวัติ `/technician/history`: same `requireRole(["technician"])`, reads only what it needs (`get_my_worker_profile`, `get_my_wage_payments`, receipts query, pending-bank query, `bankExempt` read — copy the exact queries from the current page, they are already RLS-self-scoped), renders `WorkerHistorySections`. `bankExempt` hides the bank section — carry the rule, RED-test it.
- Tab label ประวัติ: check whether the WP-detail ประวัติ tab label lives in `labels.ts`; if yes reuse the constant, if it is inline (the house bar pattern is inline labels — 313 D2 lesson) write it inline and note the accepted D4 exception (spec §2 D3). Do what the SSOT test (`ui-term-consistency`) demands — run it and follow the failure, don't guess.
- Both technician pages mount `<BottomTabBar role="technician" />` + HubNav strip (they render NONE today). The custom header + `LogoutButton` stay.
- ⚠️ Section-orphan check (spec §3.2): before committing, list every JSX section of the OLD page and name its new home. A section with no home = the split removed a signal = not shippable.

- [ ] **Step 1: RED constant tests** — bar test file: `tabsForRole("technician")` returns the 3-tab set (exact hrefs/labels); strip mirrors. Run `nav-law-strip-superset` too → watch technician get picked up. Fail first (arm returns null).
- [ ] **Step 2: Add `TECHNICIAN_TABS` / `TECHNICIAN_HUB_NAV` + resolver arms.** Tests PASS.
- [ ] **Step 3: RED history-page tests** — RTL `WorkerHistorySections`: renders payment rows sorted desc (fixture with two periods), receipts section, bank hidden when `bankExempt`. Run → fail.
- [ ] **Step 4: Extract `WorkerHistorySections`** (move the JSX — money half — verbatim from `worker-portal-sections.tsx`; slim the original; update ITS existing tests for the reduced surface, deliberately: each removed assertion must reappear in the new file's tests, count them).
- [ ] **Step 5: Build `/technician/history/page.tsx`** (reads + chrome + `WorkerHistorySections`). RED-first via a source-scan pin in a new `tests/unit/technician-history-page.test.ts` (comments stripped; `WorkerHistorySections` ≥2; `requireRole` present; `BottomTabBar` present).
- [ ] **Step 6: Reorder `/technician`** (QR first) + mount chrome + drop moved sections. Update the page's existing pins. `nav-back-affordance`: add `technician/history` to NON_DETAIL (tab destination, no back chip).
- [ ] **Step 7: Mutation-checks** (commit first): delete the `tabsForRole` technician arm → constant test + nav-law red; delete the history mount → source pin red; flip `bankExempt` handling → RTL red. Verify run counts ≠ 0.
- [ ] **Step 8: Gates + ship.** Full suite + `pnpm build`. Browser: **view-as technician** (technician ∈ ASSUMABLE_ROLES — verified at plan time): 3 tabs render on both pages, correct lighting on each, ประวัติ shows wage/receipts/bank, หน้าหลัก leads with QR; no console errors. `ship-pr.sh "feat(technician): 3-tab bar + ประวัติ route split (spec 376 U3)"`.

---

### Task 4 (U4): shared-phone register interstitial

**Files:**
- Create: `src/components/features/register/foreign-session-notice.tsx`
- Create: `tests/unit/foreign-session-notice.test.tsx`
- Modify: `src/app/register/technician/page.tsx` (mount before the workspace)
- Inspect at build: `src/app/register/office/page.tsx` — if its landing has the same hazard (a live session + QR params), mount the same component; if its flow already handles a signed-in visitor, record why not, in the PR body.

**Design (locked):**
- Server-side predicate IN THE PAGE (the register workspace already reads the session — follow its existing auth read): a session exists AND that user is NOT a fresh registrant — concretely: `role !== "visitor"` OR the user already has an approved/submitted own `staff_registration`. That user's phone is being borrowed → render the notice INSTEAD of the workspace: `เข้าสู่ระบบในชื่อ <display name> อยู่` + one primary action `ออกจากระบบเพื่อสมัครใหม่` (logout that RETURNS to the current URL with its QR params intact — read how `LogoutButton` redirects at build; if it hardcodes `/login`, extend it with an optional `next` prop rather than forking a second logout).
- A visitor mid-own-registration is NOT blocked (they ARE the registrant — the predicate above must let them through). RED-test both directions.
- ⚠️ Prose gate-check: the notice names a real button — write the copy AFTER the button exists, assert the rendered strings.

- [ ] **Step 1: RED tests** — component renders name + logout action for a foreign session; page-level pin: predicate function (extract it pure: `isForeignSession({ role, hasOwnRegistration }): boolean`) iterated over the full role domain (`Object.keys(USER_ROLE_LABEL)` — exhaustive-domain rule, exact positive set: every role except `visitor` is foreign; `visitor` foreign only when… decide: visitor + no own registration = NOT foreign; visitor + own registration = NOT foreign either, it's their flow — so positive set = all roles ≠ visitor. Pin exactly that with `toEqual`).
- [ ] **Step 2: Implement + mount.** PASS.
- [ ] **Step 3: Mutation-check** (commit first): delete the mount → pin red; invert the predicate → domain test red.
- [ ] **Step 4: Gates + ship.** Full suite; browser: as a signed-in super_admin open `/register/technician?...` → notice renders, workspace hidden; logout returns to the same URL params (read the anchor/action target). `ship-pr.sh "feat(register): shared-phone session interstitial (spec 376 U4)"`.

---

### Task 5 (U5): site_owner landing + page-gate audit — **DANGER (role-home.ts), operator merge**

**Files:**
- Modify: `src/lib/auth/role-home.ts` (site_owner arm — **danger path**)
- Modify: `src/lib/nav/projects-landing.ts` (widen the redirect predicate)
- Modify: `src/components/features/chrome/bottom-tab-bar.tsx` + `hub-nav.tsx` (SITE_OWNER arms)
- Modify: `tests/unit/` — roleHome pins, bar/strip pins, `nav-law-strip-superset` picks the role up automatically
- Modify: `docs/site-map.md`
- Audit output: a decision table in the PR body (see Step 1)

**Design (locked):**
- `roleHome("site_owner")` → `"/projects"` (insert BEFORE the `/coming-soon` fallthrough, with a spec-376 comment; roleHome stays PURE — the project resolution lives in the redirect, exactly like the SA's).
- `projects-landing.ts`: predicate `role !== "site_admin"` becomes a two-member set `PROJECT_LANDING_ROLES = ["site_admin", "site_owner"]` (exported, pinned with the exhaustive-domain pattern — exact positive set). All the existing `?view=all` loop-proofing is inherited free.
- `SITE_OWNER_TABS = [ {โครงการ, /projects, FolderKanban}, SETTINGS_TAB ]` (the COORDINATOR_TABS shape); `SITE_OWNER_HUB_NAV` mirrors + `/settings`.
- ⚠️ The `/projects` page's redirect call site and `getSaCurrentProject` were written for SA. At build, verify for site_owner: ① the call site passes `ctx.role` through (grep `saProjectsLandingTarget` call in `src/app/projects/page.tsx`); ② `getSaVisibleProjects`' `project_members` embed — read the LIVE `project_members` SELECT policy (`pnpm exec supabase db query --linked` from the MAIN repo: `select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid='public.project_members'::regclass`) and confirm site_owner can read own membership rows. If the policy refuses, the redirect silently no-ops (empty visible list → null → hub) — that is a SAFE degradation, but record it and surface to the operator; do NOT widen RLS in this unit (schema lane).

- [ ] **Step 1: the page-gate audit (before any code).** Enumerate the gate of every `/projects` + `/projects/[projectId]/*` page: `grep -rn "requireRole\|WP_DETAIL_ROLES\|SCHEDULE_VIEW\|can_see" src/app/projects --include="page.tsx" -A2`. Produce the table: route · current set · site_owner admitted? · decision (admit read pages: hub, WP list/detail, schedule, reports?; refuse writes/money: store, incoming, team, costs, rentals, settings — D2 read-mostly). **Each ADMIT is one explicit gate edit + a RED-first allowlist test using the exhaustive-domain pattern** (never a hand-list — the spec-348-U5 lesson). Fold the table into the PR body; anything ambiguous → 🔔 operator before widening.
- [ ] **Step 2: RED roleHome + resolver + constants tests** (roleHome pin `site_owner → /projects`; `PROJECT_LANDING_ROLES` exact positive set over the full enum; tab/strip sets). Run → fail.
- [ ] **Step 3: Implement** all four files. Tests + `nav-law-strip-superset` PASS (it now auto-covers site_owner — an expected NEW green; if it stays green BEFORE your arms land, stop: the filter is broken).
- [ ] **Step 4: Gate edits from the Step-1 table**, each RED-first.
- [ ] **Step 5: Mutation-checks** (commit first): remove the roleHome arm → pin red; widen `PROJECT_LANDING_ROLES` with a third role → domain test red (the ADD direction must bite).
- [ ] **Step 6: Gates + ship.** Full suite + build. ⚠️ site_owner ∉ `ASSUMABLE_ROLES` (verified at plan time) — browser view-as is IMPOSSIBLE; verification = the guard suite + (operator-optional) a throwaway site_owner user with a membership row on the pilot project. Say exactly that in the PR body — never claim a browser proof that didn't run. `ship-pr.sh "feat(nav): site_owner landing + tabs (spec 376 U5)"` → **operator merge** (danger hold is by design).

---

## Task order & serialization

1 → 3 (chrome files), 2 / 4 anytime, 5 last (danger + audit). LANES: this lane owns `bottom-tab-bar.tsx`, `hub-nav.tsx`, `role-home.ts`, `labels.ts` (additive) for the duration — re-check LANES before each task.

## Self-review notes (done at write time)

- Spec coverage: U1→Task1, U2→Task2, U3→Task3, U4→Task4, U5→Task5, §6 QR map = spec §6 (docs, shipped with the spec PR — no task needed), §7 acceptance queries = each task's ship gate + the next session's fill-rate follow-ups.
- Type consistency: `saProjectsTabHref` named identically in helper/tests/bar; `WorkerHistorySections` props copied from the live component at extraction time (plan deliberately does not restate field types — the live file is the SSOT and drifts).
- No placeholders: the two "decide at build" points (hub-page pin shape in Task 2 Step 3, ประวัติ label home in Task 3) name the exact command/test that decides them, not "TBD".
