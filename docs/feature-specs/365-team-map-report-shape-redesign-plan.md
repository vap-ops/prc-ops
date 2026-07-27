# Team-map redesign (spec 365) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup `/projects/:id/team` into the operator's own daily-report shape (ทีมภายใน → ทีมภายนอก → สนับสนุน), add a top-of-page fix-list of database-derivable gaps, and demote the day-plan layer to its own tab.

**Architecture:** Code-only. The pure builder (`build-team-map.ts`) gains one new derived concept (a firm known-to-this-project even with zero active workers); the loader (`load-team-map.ts`) gains one small additional query to support it; the view (`team-map-view.tsx`, 1243 lines) is split into three smaller files (the file itself, a new `fix-list-card.tsx`, a new `plan-tab.tsx`) rather than growing further. No RPC, no migration, no schema.

**Tech Stack:** Next.js App Router (Server Component page + this Client Component view), Supabase (RLS session client + one admin-seam read, both pre-existing), Vitest + Testing Library, existing house design tokens (`TIER_BOX`, `CARD`, `BADGE`, etc. — already defined in `team-map-view.tsx`, reused not redefined).

## Global Constraints

- **No schema, no new RPC, no migration.** Every write path (`createCrew`, `addWorkerToCrew`, `removeWorkerFromCrew`, `moveWorkerBetweenCrews`, `setCrewLead`, `renameCrew`, `dissolveCrew`, `addProjectMember`, `removeProjectMember`, `setPrimaryProjectFor`, `addDailyPlanItem`, `applyPlanSuggestions`, `setDailyPlanItemCrew`) keeps its exact existing signature and gate.
- **Token classes only** — no raw Tailwind palette (design-doctrine guard); reuse the existing constants in `team-map-view.tsx` (`TIER_BOX`, `TIER_HEADING`, `TIER_ACTION`, `TIER_ACTION_PRIMARY`, `CARD`, `CHIP`, `CHIP_EXEMPT`, `BADGE`, `SHEET_ACTION`, `SHEET_PRIMARY`, `SHEET_DANGER`, `INFO_BTN`, `TOGGLE`, `AVATAR`) rather than inventing new ones.
- **`contractors` has no `project_id` column.** Any firm-scoping query must go through `workers.project_id`, never a bare `contractors` select.
- **A firm's zero-worker card offers exactly one door** (`แชร์ QR สมัคร` → `/team/poster?contractor=<id>&project=<id>`, a plain link, no new component). No manual-add door — that path does not exist in this codebase (ADR 0073).
- **Every unit follows the repo's `ship-unit` gate**: lane claim in `../LANES.md` → dependency gate-check against live code/DB → RED-first test → `pnpm lint && pnpm typecheck && pnpm test` green → real-flow browser verify → fresh-eyes review → ship via `scripts/ship-pr.sh`. This plan's tasks assume that loop; it is not repeated in every task.

---

## File Structure

| File                                                                                                                                                                               | Change                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/team-map/build-team-map.ts`                                                                                                                                               | Modify — `BuildProjectTeamMapInput` gains `projectContractorIds: string[]`; firm-card construction seeds from the union of that list and active firm-workers' contractor ids, so a known-but-currently-empty firm still gets a card. |
| `src/lib/team-map/load-team-map.ts`                                                                                                                                                | Modify — one additional query for `projectContractorIds`; the `contractors` name-map fetch widens to cover them.                                                                                                                     |
| `src/lib/team-map/trade-hint.ts`                                                                                                                                                   | **New** — `leadTradesOf` moved out of `team-map-view.tsx` so both it and the new `plan-tab.tsx` can import it without a circular dependency.                                                                                         |
| `src/components/features/team-map/action-classes.ts`                                                                                                                               | **New** — `TIER_ACTION_BASE`/`TIER_ACTION`/`SHEET_ACTION` moved out of `team-map-view.tsx` so both it and `plan-tab.tsx` share one copy instead of two.                                                                              |
| `src/lib/team-map/fix-list.ts`                                                                                                                                                     | **New** — pure function `deriveTeamMapFixList(map: ProjectTeamMap): FixListItem[]`.                                                                                                                                                  |
| `src/components/features/team-map/fix-list-card.tsx`                                                                                                                               | **New** — presentational card rendering the fix-list, one tap handler per item.                                                                                                                                                      |
| `src/components/features/team-map/plan-tab.tsx`                                                                                                                                    | **New** — the day-plan tray, day-toggle, `เพิ่มงานเข้าแผน`/`planChip` sheets, and the compact ทีมภายใน crew list used as placing-mode drop targets. Extracted verbatim from `team-map-view.tsx`.                                     |
| `src/components/features/team-map/team-map-view.tsx`                                                                                                                               | Modify — sections regrouped/renamed; `TeamCard`'s firm branch gains the zero-count QR-only state; tabs added; plan-layer code removed (moved to `plan-tab.tsx`).                                                                     |
| `tests/unit/build-team-map.test.ts`                                                                                                                                                | Modify — new fixture cases for `projectContractorIds`.                                                                                                                                                                               |
| `tests/unit/fix-list.test.ts`                                                                                                                                                      | **New**.                                                                                                                                                                                                                             |
| `tests/unit/fix-list-card.test.tsx`                                                                                                                                                | **New**.                                                                                                                                                                                                                             |
| `tests/unit/plan-tab.test.tsx`                                                                                                                                                     | **New** — the tray/toggle/sheets tests currently inside `team-map-plan.test.tsx`, moved and adapted to the extracted component.                                                                                                      |
| `tests/unit/team-map-view.test.tsx`, `team-map-look.test.tsx`, `team-map-legibility.test.tsx`, `team-map-crew-manage.test.tsx`, `team-map-plan.test.tsx`, `team-map-gate.test.tsx` | Modify — region-name selectors updated from `ผู้บริหารโครงการ`/`หน้างาน`/`ทีมช่าง` to `สนับสนุน`/`ทีมภายใน`/`ทีมภายนอก`; plan-specific cases move to `plan-tab.test.tsx`.                                                            |

---

## U1 — Regroup, rename, firm scoping

### Task 1: `build-team-map.ts` — known-but-empty firm cards

**Files:**

- Modify: `src/lib/team-map/build-team-map.ts`
- Test: `tests/unit/build-team-map.test.ts`

**Interfaces:**

- Consumes: nothing new from elsewhere.
- Produces: `BuildProjectTeamMapInput.projectContractorIds: string[]` (new field); `UNASSIGNED_TEAM_ID` exported constant (`"unassigned"`, replacing the inline literal so `fix-list.ts` never duplicates the magic string); `TeamMapTeamCard` shape unchanged (a firm card with `count: 0` and `members: []` is already a valid instance of the existing type).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/build-team-map.test.ts` (after the existing `"firm card: groups contractor workers..."` test):

```ts
it("a firm known to this project via a PAST (inactive) worker still gets a card, even with zero active names", () => {
  const map = build({
    // w-firm2 (มานะ) is inactive today, but was on this project under c-uay.
    workers: workers.filter((w) => w.id !== "w-firm2"),
    projectContractorIds: ["c-uay", "c-empty"],
    contractors: new Map([
      ["c-uay", "ทีมช่างอวย"],
      ["c-empty", "ห้างหุ้นส่วนว่างเปล่า"],
    ]),
  });
  const empty = map.teams.find((t) => t.id === "c-empty");
  expect(empty).toMatchObject({ kind: "firm", name: "ห้างหุ้นส่วนว่างเปล่า", count: 0 });
  expect(empty?.members).toEqual([]);
  // c-uay still has w-firm1 active — both firms present, not deduped away.
  expect(
    map.teams
      .filter((t) => t.kind === "firm")
      .map((t) => t.id)
      .sort(),
  ).toEqual(["c-empty", "c-uay"]);
});

it("a contractor NOT in projectContractorIds never gets a card, even if it happens to be in the `contractors` map", () => {
  // The whole point of the scoping fix: contractors has no project_id, so a
  // firm must be excluded unless its id came from a real workers row on
  // THIS project.
  const map = build({
    projectContractorIds: ["c-uay"],
    contractors: new Map([
      ["c-uay", "ทีมช่างอวย"],
      ["c-other-site", "บริษัทอื่นไซต์"],
    ]),
  });
  expect(map.teams.some((t) => t.id === "c-other-site")).toBe(false);
});

it("UNASSIGNED_TEAM_ID matches the pool card's real id", () => {
  const map = build();
  const pool = map.teams.find((t) => t.kind === "unassigned");
  expect(pool?.id).toBe(UNASSIGNED_TEAM_ID);
});
```

Add the import at the top of the test file:

```ts
import { buildProjectTeamMap, UNASSIGNED_TEAM_ID } from "@/lib/team-map/build-team-map";
```

And add `projectContractorIds: []` to the `build()` helper's default args object (so every existing test keeps passing unchanged):

```ts
function build(overrides: Partial<Parameters<typeof buildProjectTeamMap>[0]> = {}) {
  return buildProjectTeamMap({
    projectLeadId: "u-pm",
    members: [
      /* unchanged */
    ],
    users,
    workers,
    crews,
    crewMembers,
    contractors,
    projectContractorIds: [],
    ...overrides,
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/build-team-map.test.ts`
Expected: FAIL — `UNASSIGNED_TEAM_ID` is not exported, and `projectContractorIds` is not a recognized property of the input type (TS error surfaces as a test-file compile failure).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/team-map/build-team-map.ts`:

```ts
export const UNASSIGNED_TEAM_ID = "unassigned";
```

Add to `BuildProjectTeamMapInput`:

```ts
export interface BuildProjectTeamMapInput {
  projectLeadId: string | null;
  members: { user_id: string; is_primary: boolean }[];
  users: Map<string, { name: string | null; role: string }>;
  workers: { id: string; name: string; contractor_id: string | null }[];
  crews: { id: string; name: string; lead_worker_id: string | null; active: boolean }[];
  crewMembers: { crew_id: string; worker_id: string; removed_at: string | null }[];
  contractors: Map<string, string>;
  // Spec 365 U1 — contractor ids with AT LEAST ONE workers row (active or
  // inactive) scoped to THIS project. `contractors` carries no project_id, so
  // this is the only correct scoping source — never derive a firm list from
  // the whole company table.
  projectContractorIds: string[];
}
```

Replace the firm-card construction block:

```ts
// Firm teams: contractor-tied workers not already in an active crew, PLUS
// any contractor known to this project (projectContractorIds) even with
// zero currently-active names — the "had someone here, none active now"
// state the fix-list surfaces.
const firmWorkers = input.workers.filter(
  (w) => w.contractor_id !== null && !inActiveCrew.has(w.id),
);
const byFirm = new Map<string, typeof firmWorkers>();
for (const id of input.projectContractorIds) byFirm.set(id, []);
for (const w of firmWorkers) {
  const key = w.contractor_id as string;
  byFirm.set(key, [...(byFirm.get(key) ?? []), w]);
}
const firmCards: TeamMapTeamCard[] = [...byFirm.entries()]
  .map(([contractorId, list]) => ({
    kind: "firm" as const,
    id: contractorId,
    name: input.contractors.get(contractorId) ?? "ทีมผู้รับเหมา",
    members: list.map((w) => ({
      workerId: w.id,
      name: w.name,
      isTeamLead: false,
      contractorId: w.contractor_id,
    })),
    count: list.length,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "th"));
```

Replace the two remaining `"unassigned"` string literals (in the `pooled` push block) with `UNASSIGNED_TEAM_ID`:

```ts
if (pooled.length > 0) {
  teams.push({
    kind: "unassigned",
    id: UNASSIGNED_TEAM_ID,
    name: "ยังไม่จัดทีม",
    members: pooled.map((w) => ({
      workerId: w.id,
      name: w.name,
      isTeamLead: false,
      contractorId: w.contractor_id,
    })),
    count: pooled.length,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/build-team-map.test.ts`
Expected: PASS, all tests including the 3 new ones and the pre-existing ones (the `"firm card: groups contractor workers..."` test builds with `contractors = new Map([["c-uay", "ทีมช่างอวย"]])` but no `projectContractorIds` override — default `[]` means `byFirm` still gets `c-uay` seeded purely from `firmWorkers`, matching today's behavior exactly).

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-map/build-team-map.ts tests/unit/build-team-map.test.ts
git commit -m "feat(team-map): firm cards seed from project-scoped contractor ids, not just active workers"
```

---

### Task 2: `load-team-map.ts` — supply `projectContractorIds`

**Files:**

- Modify: `src/lib/team-map/load-team-map.ts`

**Interfaces:**

- Consumes: `buildProjectTeamMap`'s new `projectContractorIds` field (Task 1).
- Produces: nothing new externally — `loadTeamMapPageData`'s return shape (`TeamMapPageData`) is unchanged.

No dedicated unit test exists for this loader (matches the repo's existing pattern for `server-only` I/O loaders — verified via the pure builder's tests plus real-flow browser checks at ship time, not mocked separately). This task is verified by Task 6's real-flow step.

- [ ] **Step 1: Add the broader worker query**

In `src/lib/team-map/load-team-map.ts`, add a new query to the existing `Promise.all` (do not remove the existing `active: true` workers query — that one still drives which workers RENDER as named chips; this is a second, narrower query purely for firm-scoping):

```ts
const [
  { data: members },
  { data: workers },
  { data: crews },
  { data: staff },
  { data: allProjectContractorWorkers },
] = await Promise.all([
  supabase
    .from("project_members")
    .select("user_id, is_primary")
    .eq("project_id", projectId)
    .order("added_at"),
  supabase
    .from("workers")
    .select("id, name, contractor_id")
    .eq("project_id", projectId)
    .eq("active", true)
    .order("name"),
  supabase
    .from("crews")
    .select("id, name, lead_worker_id, active, crew_members(crew_id, worker_id, removed_at)")
    .eq("project_id", projectId),
  admin
    .from("users")
    .select("id, full_name, role")
    .in("role", [...PROJECT_TEAM_STAFF_ROLES])
    .order("full_name", { nullsFirst: false }),
  // Spec 365 — ACTIVE OR NOT: a firm this project has ever had a worker
  // under, even if none are active today. `contractors` has no project_id,
  // so this is the only correct scoping source.
  supabase
    .from("workers")
    .select("contractor_id")
    .eq("project_id", projectId)
    .not("contractor_id", "is", null),
]);
```

- [ ] **Step 2: Widen the contractor-name fetch and pass the new field**

Replace the `contractorIds` derivation and the `buildProjectTeamMap` call:

```ts
// Firm names for the contractor cards (privileged-role SELECT policy).
// Union of: active workers' contractor_id (today's named members) and the
// broader project-scoped set (Task 1's known-but-empty firms).
const projectContractorIds = [
  ...new Set((allProjectContractorWorkers ?? []).map((w) => w.contractor_id as string)),
];
const contractorIds = [
  ...new Set([
    ...projectContractorIds,
    ...(workers ?? []).map((w) => w.contractor_id).filter((id): id is string => !!id),
  ]),
];
const contractors = new Map<string, string>();
if (contractorIds.length > 0) {
  const { data: firms } = await supabase
    .from("contractors")
    .select("id, name")
    .in("id", contractorIds);
  for (const f of firms ?? []) contractors.set(f.id, f.name);
}

const crewRows = crews ?? [];
const map = buildProjectTeamMap({
  projectLeadId,
  members: memberRows,
  users,
  workers: workers ?? [],
  crews: crewRows.map((c) => ({
    id: c.id,
    name: c.name,
    lead_worker_id: c.lead_worker_id,
    active: c.active,
  })),
  crewMembers: crewRows.flatMap((c) => c.crew_members),
  contractors,
  projectContractorIds,
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean — the new field is required on `BuildProjectTeamMapInput`, so a missing pass-through would fail here first.

- [ ] **Step 4: Commit**

```bash
git add src/lib/team-map/load-team-map.ts
git commit -m "feat(team-map): loader supplies project-scoped contractor ids to the builder"
```

---

### Task 3: Extract `leadTradesOf` and the shared action-button classes out of `team-map-view.tsx`

**Files:**

- Create: `src/lib/team-map/trade-hint.ts`
- Create: `src/components/features/team-map/action-classes.ts`
- Modify: `src/components/features/team-map/team-map-view.tsx`

**Interfaces:**

- Produces: `leadTradesOf(team: TeamMapTeamCard, trades?: Record<string, WorkerTrade[]>): WorkerTrade[]` — consumed by Tasks 4/5 (unchanged call sites in `team-map-view.tsx`) and by Task 8 (the new `plan-tab.tsx`).
- Produces: `TIER_ACTION_BASE`, `TIER_ACTION`, `SHEET_ACTION` (string constants, byte-identical to the values currently local to `team-map-view.tsx` at lines 107–109 and 136–137) — consumed by Task 5 (unchanged call sites in `team-map-view.tsx`) and by Task 8 (the new `plan-tab.tsx`). Task 8's implementer must import these, not redefine them — `plan-tab.tsx` and `team-map-view.tsx` both use these exact three classes and a second local copy would silently drift from the first on a future edit.

This is a pure relocation — no behavior change, so no new test; the existing `team-map-plan.test.tsx` / `team-map-legibility.test.tsx` / `ui-class-contracts.test.tsx` cases keep passing unmodified since every value is byte-identical to today's.

- [ ] **Step 1: Create `trade-hint.ts`**

```ts
// Spec 365 — leadTradesOf moved out of team-map-view.tsx so both it and the
// new plan-tab.tsx can read a team's lead trades without a circular import
// between the two component files.
import type { TeamMapTeamCard } from "./build-team-map";
import type { WorkerTrade } from "@/lib/workers/trades";

export function leadTradesOf(
  team: TeamMapTeamCard,
  trades?: Record<string, WorkerTrade[]>,
): WorkerTrade[] {
  const lead = team.members.find((m) => m.isTeamLead);
  return lead ? (trades?.[lead.workerId] ?? []) : [];
}
```

- [ ] **Step 2: Create `action-classes.ts`**

```ts
// Spec 365 — the three action-button token classes team-map-view.tsx and
// plan-tab.tsx both render (a full-width sheet row, a pill-shaped tier
// action). Shared here so the two component files never hold two copies of
// the same class string.
//
// Colour-free base — some callers swap the ink per selected state, and a
// `text-action` baked into TIER_ACTION would fight it in the generated
// stylesheet (see tests/unit/ui-class-contracts.test.tsx).
export const TIER_ACTION_BASE =
  "border-edge bg-card inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium";
export const TIER_ACTION = `${TIER_ACTION_BASE} text-action`;
export const SHEET_ACTION =
  "border-edge text-ink flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-sm";
```

- [ ] **Step 3: Remove the local definitions in `team-map-view.tsx` and import instead**

Delete the `function leadTradesOf(...)` block (lines 210–216) and the `const TIER_ACTION_BASE` / `const TIER_ACTION` / `const SHEET_ACTION` declarations (lines 107–109 and 136–137) — leave every OTHER local constant (`TIER_HEADING`, `TIER_BOX`, `TIER_ACTION_PRIMARY`, `SHEET_PRIMARY`, `SHEET_DANGER`, `INFO_BTN`, `AVATAR`, `CARD`, `STAFF_ROW`, `BADGE`, `CHIP`, `CHIP_EXEMPT`, `TOGGLE`) exactly where they are — only these three move. Add to the existing import block:

```ts
import { leadTradesOf } from "@/lib/team-map/trade-hint";
import { TIER_ACTION_BASE, TIER_ACTION, SHEET_ACTION } from "./action-classes";
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm exec vitest run tests/unit/team-map-view.test.tsx tests/unit/team-map-plan.test.tsx tests/unit/team-map-legibility.test.tsx tests/unit/team-map-crew-manage.test.tsx tests/unit/team-map-look.test.tsx tests/unit/team-map-gate.test.tsx tests/unit/ui-class-contracts.test.tsx`
Expected: PASS, unchanged (pure relocation).

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-map/trade-hint.ts src/components/features/team-map/action-classes.ts src/components/features/team-map/team-map-view.tsx
git commit -m "refactor(team-map): extract leadTradesOf and shared action-button classes to their own modules"
```

---

### Task 4: Merge ผู้บริหารโครงการ + หน้างาน into สนับสนุน

**Files:**

- Modify: `src/components/features/team-map/team-map-view.tsx`
- Modify: `tests/unit/team-map-view.test.tsx`, `tests/unit/team-map-look.test.tsx`

**Interfaces:**

- Consumes: `map.management: TeamMapStaffNode[]`, `map.site: TeamMapStaffNode[]` (both already produced by the unchanged builder).
- Produces: one rendered `<section aria-label="สนับสนุน">` replacing the two existing sections. `ProjectTeamMap.management`/`.site` themselves are **not** renamed or merged at the type level — only how the view renders them changes, so `build-team-map.ts` and its tests need zero edits here.

- [ ] **Step 1: Write the failing test**

In `tests/unit/team-map-view.test.tsx`, replace the assertions inside `"renders tiers with the crew summary and collapsed member lists"` that check for two separate regions, and add a dedicated case. First, the existing test currently checks:

```ts
expect(screen.getByText(/ผู้บริหารโครงการ/)).toBeInTheDocument();
expect(screen.getByText(/หน้างาน · /)).toBeInTheDocument();
```

Replace with:

```ts
expect(screen.getByRole("region", { name: "สนับสนุน" })).toBeInTheDocument();
expect(screen.queryByRole("region", { name: "ผู้บริหารโครงการ" })).not.toBeInTheDocument();
expect(screen.queryByRole("region", { name: "หน้างาน" })).not.toBeInTheDocument();
```

Add a new test after it:

```ts
it("สนับสนุน renders both management and site staff in ONE list, no PM/SA sub-headers", () => {
  renderView();
  const support = screen.getByRole("region", { name: "สนับสนุน" });
  // MAP fixture: u-pm (management) + u-sa1/u-sa2 (site) = 3 staff total.
  expect(within(support).getByText("สมชาย ใจดี")).toBeInTheDocument();
  expect(within(support).getByText("อรปรีญา เงางาม")).toBeInTheDocument();
  expect(within(support).getByText("ประวิทย์ คงมั่น")).toBeInTheDocument();
  expect(within(support).getByText("สนับสนุน · 3 คน")).toBeInTheDocument();
});
```

In `tests/unit/team-map-look.test.tsx`, update the region-name selectors (lines ~109, ~120, ~129) from `ผู้บริหารโครงการ`/`หน้างาน` to `สนับสนุน` — both now resolve to the SAME region, so the two separate `it` blocks that queried them individually collapse into assertions against the one region. Read the file's exact current cases before editing (`pnpm exec vitest run tests/unit/team-map-look.test.tsx` first, to see the current failure text) and adjust each to query `screen.getByRole("region", { name: "สนับสนุน" })` instead of the two former names, keeping each test's actual behavioral assertion (which button appears, etc.) unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/team-map-view.test.tsx tests/unit/team-map-look.test.tsx`
Expected: FAIL — the sections are still separate.

- [ ] **Step 3: Write minimal implementation**

In `team-map-view.tsx`, replace the two `<section aria-label="ผู้บริหารโครงการ">` and `<section aria-label="หน้างาน">` blocks (lines 577–641) with one:

```tsx
<section aria-label="สนับสนุน" className={TIER_BOX}>
  <div className="mb-2 flex items-center gap-2">
    <Briefcase aria-hidden className="text-ink-secondary size-4 shrink-0" />
    <p className={`${TIER_HEADING} min-w-0 flex-1 truncate`}>
      สนับสนุน · {map.management.length + map.site.length} คน
    </p>
    <button
      type="button"
      className={INFO_BTN}
      aria-label="คำอธิบายบทบาทสนับสนุน"
      onClick={() => openSheet({ type: "info", tier: "management" })}
    >
      <Info aria-hidden className="size-4" />
    </button>
    <button type="button" className={TIER_ACTION} onClick={() => openSheet({ type: "add" })}>
      <UserPlus aria-hidden className="size-3.5" /> เพิ่มสมาชิก
    </button>
  </div>
  <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:justify-center sm:[&>button]:min-w-56 sm:[&>button]:flex-none">
    {[...map.management, ...map.site].map((n) => (
      <StaffRow key={n.userId} node={n} onOpen={() => openSheet({ type: "staff", node: n })} />
    ))}
    {map.management.length === 0 && map.site.length === 0 ? (
      <p className="text-ink-muted text-xs">ยังไม่มีทีมสนับสนุน</p>
    ) : null}
  </div>
</section>
```

Remove the `<div className="border-edge-strong ml-6 h-4 border-l sm:mx-auto" aria-hidden />` divider that used to sit BETWEEN the two removed sections (line 609) — only the divider before the ทีมภายใน/ทีมภายนอก group (line 643–649) remains, unchanged.

In the `info` `BottomSheet`'s title logic (around line 1153–1164), collapse the two-tier ternary into one:

```tsx
        title={
          sheet?.type === "info"
            ? sheet.tier === "crew"
              ? "บทบาท — ทีมภายใน"
              : sheet.tier === "firm"
                ? "บทบาท — ทีมภายนอก"
                : "บทบาท — สนับสนุน"
            : ""
        }
```

(The `"firm"` tier value is introduced in Task 5; add it to the `InfoTier` union now: `type InfoTier = "management" | "site" | "crew" | "firm";` — `"site"` stays in the union for type continuity but is never produced by a UI trigger any more.)

And where the info sheet BODY renders `TEAM_MAP_ROLE_HELP[sheet.tier].map(...)`, change it to concatenate management+site when the tier is `"management"`:

```tsx
        {sheet?.type === "info" ? (
          <div className="flex flex-col gap-3">
            {(sheet.tier === "management"
              ? [...TEAM_MAP_ROLE_HELP.management, ...TEAM_MAP_ROLE_HELP.site]
              : TEAM_MAP_ROLE_HELP[sheet.tier === "firm" ? "crew" : sheet.tier]
            ).map((entry) => (
```

(`"firm"` has no dedicated help copy — it reuses `TEAM_MAP_ROLE_HELP.crew`'s entries, which describe team structure generically; this is acceptable since Task 5 does not add new firm-specific role copy.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/team-map-view.test.tsx tests/unit/team-map-look.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full local suite + typecheck**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green — this will surface any OTHER test file still asserting the old two-section shape (check `tests/unit/team-map-legibility.test.tsx`, `team-map-crew-manage.test.tsx`, `team-map-gate.test.tsx`, `team-map-plan.test.tsx` for `ผู้บริหารโครงการ`/`หน้างาน` region queries and fix each the same way).

- [ ] **Step 6: Commit**

```bash
git add src/components/features/team-map/team-map-view.tsx tests/unit/team-map-view.test.tsx tests/unit/team-map-look.test.tsx
git commit -m "feat(team-map): merge ผู้บริหารโครงการ+หน้างาน into one สนับสนุน section"
```

---

### Task 5: Split ทีมช่าง into ทีมภายใน (crews) + ทีมภายนอก (firms), zero-worker firm card

**Files:**

- Modify: `src/components/features/team-map/team-map-view.tsx`
- Modify: `tests/unit/team-map-legibility.test.tsx`, `tests/unit/team-map-crew-manage.test.tsx`, `tests/unit/team-map-gate.test.tsx`

**Interfaces:**

- Consumes: `map.teams: TeamMapTeamCard[]` (unchanged shape; Task 1 already made firm-with-zero-workers a real member of this array).
- Produces: two new `<section>`s (`ทีมภายใน`, `ทีมภายนอก`) replacing the one `ทีมช่าง` section; `TeamCard`'s firm branch renders a QR-only door when `count === 0`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/team-map-legibility.test.tsx`, update the region query (~line 132) from `ทีมช่าง` to `ทีมภายใน` for the crew-specific assertions there. In `tests/unit/team-map-crew-manage.test.tsx` (~line 320), same: `ตั้งทีม creates a crew from the ทีมช่าง header button` → query `screen.getByRole("region", { name: "ทีมภายใน" })`.

Add a new test to `tests/unit/team-map-crew-manage.test.tsx` (reusing its existing `MAP` fixture, which already has a `kind: "firm"` card `f-1` with one named member — add a SECOND firm fixture entry with zero members for this case, or add a fresh `it` with an inline override):

```ts
  it("a firm with zero members renders one QR-only door, no manual-add button", () => {
    const EMPTY_FIRM_MAP: ProjectTeamMap = {
      ...MAP,
      teams: [
        ...MAP.teams,
        { kind: "firm", id: "f-empty", name: "บริษัทว่างเปล่า", members: [], count: 0 },
      ],
    };
    render(
      <TeamMapView projectId={PROJECT} map={EMPTY_FIRM_MAP} addableStaff={[]} currentUserId="u-pm" />,
    );
    const card = screen.getByTestId("team-card-f-empty");
    expect(within(card).getByRole("link", { name: /แชร์ QR สมัคร/ })).toHaveAttribute(
      "href",
      `/team/poster?contractor=f-empty&project=${PROJECT}`,
    );
    expect(within(card).queryByRole("button", { name: /เพิ่มในระบบเอง/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/team-map-crew-manage.test.tsx tests/unit/team-map-legibility.test.tsx`
Expected: FAIL — the region is still named `ทีมช่าง`; the QR-only door doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `team-map-view.tsx`, split `map.teams` into two derived arrays right before the return's JSX (near the other `useMemo`/derived-value block, e.g. after `otherCrews`):

```ts
const crewCards = map.teams.filter((t) => t.kind === "crew");
const firmCards = map.teams.filter((t) => t.kind === "firm");
const unassignedCard = map.teams.find((t) => t.kind === "unassigned") ?? null;
```

Replace the single `<section aria-label="ทีมช่าง">` block (lines 651–791) with two sections. **ทีมภายใน** keeps `ตั้งทีมใหม่`, the master expand/collapse toggle, and renders `crewCards` (plus `unassignedCard` appended at the end, matching today's "pool renders last" ordering — the unassigned pool is not contractor-tied, so it belongs with the internal side, matching its existing dashed-border "pending assignment" visual, not the external side):

```tsx
      <section aria-label="ทีมภายใน" className={TIER_BOX}>
        <div className="mb-2 flex items-center gap-2">
          <Users aria-hidden className="text-ink-secondary size-4 shrink-0" />
          <p className={`${TIER_HEADING} min-w-0 flex-1 truncate`}>
            ทีมภายใน · จ้างรายวันโดย PRC · {crewCards.length} ทีม
          </p>
          <button
            type="button"
            className={INFO_BTN}
            aria-label="คำอธิบายบทบาททีมภายใน"
            onClick={() => openSheet({ type: "info", tier: "crew" })}
          >
            <Info aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            className={TIER_ACTION_PRIMARY}
            onClick={() => openSheet({ type: "createCrew" })}
          >
            <Users aria-hidden className="size-3.5" /> ตั้งทีมใหม่
          </button>
          {crewCards.length > 0 ? (
            <button
              type="button"
              className={TOGGLE}
              onClick={() =>
                setExpanded(
                  allExpanded
                    ? new Set()
                    : new Set([...crewCards, ...firmCards].map((t) => t.id)),
                )
              }
            >
              {allExpanded ? "ซ่อนทั้งหมด" : "แสดงทั้งหมด"}
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {crewCards.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              expanded={expanded.has(t.id)}
              onToggle={() => toggle(t.id)}
              onManage={() => openSheet({ type: "team", team: t })}
              onChip={(chip) => openSheet({ type: "chip", chip, team: t })}
              {...(tradesByWorker ? { tradesByWorker } : {})}
            />
          ))}
          {unassignedCard ? (
            <TeamCard
              key={unassignedCard.id}
              team={unassignedCard}
              expanded={expanded.has(unassignedCard.id)}
              onToggle={() => toggle(unassignedCard.id)}
              onManage={() => {}}
              onChip={(chip) => openSheet({ type: "chip", chip, team: unassignedCard })}
              {...(tradesByWorker ? { tradesByWorker } : {})}
            />
          ) : null}
          {crewCards.length === 0 && !unassignedCard ? (
            <p className="text-ink-muted text-xs">ยังไม่มีทีมภายใน</p>
          ) : null}
        </div>
      </section>

      <div className="border-edge-strong ml-6 h-4 border-l sm:mx-auto" aria-hidden />

      <section aria-label="ทีมภายนอก" className={TIER_BOX}>
        <div className="mb-2 flex items-center gap-2">
          <Building2 aria-hidden className="text-ink-secondary size-4 shrink-0" />
          <p className={`${TIER_HEADING} min-w-0 flex-1 truncate`}>
            ทีมภายนอก · ผู้รับเหมาช่วง · {firmCards.length} ราย
          </p>
          <button
            type="button"
            className={INFO_BTN}
            aria-label="คำอธิบายบทบาททีมภายนอก"
            onClick={() => openSheet({ type: "info", tier: "firm" })}
          >
            <Info aria-hidden className="size-4" />
          </button>
          <Link className={TIER_ACTION} href="/contacts">
            <Building2 aria-hidden className="size-3.5" /> เพิ่มผู้รับเหมาช่วง
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {firmCards.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              expanded={expanded.has(t.id)}
              onToggle={() => toggle(t.id)}
              onManage={() => {}}
              onChip={(chip) => openSheet({ type: "chip", chip, team: t })}
              {...(tradesByWorker ? { tradesByWorker } : {})}
              projectId={projectId}
            />
          ))}
          {firmCards.length === 0 ? (
            <p className="text-ink-muted text-xs">ยังไม่มีผู้รับเหมาช่วงในโครงการนี้</p>
          ) : null}
        </div>
      </section>
```

(The plan-tab tray, day-toggle and placing-mode props that were on this section move to `plan-tab.tsx` in Tasks 8–9 — for THIS task, delete the `{dayPlans && assignments ? (...) : null}` tray block and the `{...(placing && t.kind === "crew" ? {...} : {})}` spread from the crew-card render entirely; Tasks 8–9 re-add the tab and its own drop-target list. Running the suite after this task alone will show `team-map-plan.test.tsx` failing — that is expected and resolved by Task 8, not before. This is a controller-level sequencing call, not a contradiction: build Tasks 1–5 then 8–9 in one sitting before the first ship (no PR opens with `team-map-plan.test.tsx` red); a task reviewer for Task 5 is told in its global-constraints block that this specific failure is expected and out of scope for that review.)

Update `TeamCard`'s firm branch (around line 274) to add the zero-count door, and accept an optional `projectId` prop it needs to build the poster link:

```tsx
function TeamCard({
  team,
  expanded,
  onToggle,
  onManage,
  onChip,
  tradesByWorker,
  planChips,
  onPlanChip,
  projectId,
}: {
  team: TeamMapTeamCard;
  expanded: boolean;
  onToggle: () => void;
  onManage: () => void;
  onChip: (chip: TeamMapWorkerChip) => void;
  tradesByWorker?: Record<string, WorkerTrade[]>;
  planChips?: TeamDayAssignment[];
  onPlanChip?: (entry: TeamDayAssignment) => void;
  /** Spec 365 — only read for a zero-member firm card's QR door. */
  projectId?: string;
}) {
```

(Drop the `placing`/`placingCategoryCode`/`onPlaceHere` props and the placing-mode JSX block entirely, in THIS task — placing moves to `plan-tab.tsx`'s own compact list, built in Task 8, which runs after this one. Removing the props now is deliberate, per the sequencing note at Step 2 above: it leaves `tests/unit/team-map-plan.test.tsx` red between this task and Task 8, which is expected and accepted — do not re-add a stub or shim to keep it green in the interim.)

Add, right after the existing member-chips block inside the `expanded` branch (or, more simply, as a sibling condition alongside the existing `subtitle`/`Icon` logic near the top of the card, since a zero-member firm should show its door WITHOUT requiring the card to be expanded first):

```tsx
{
  team.kind === "firm" && team.count === 0 && projectId ? (
    <Link
      href={`/team/poster?contractor=${team.id}&project=${projectId}`}
      className={`${TIER_ACTION} justify-center`}
    >
      <Building2 aria-hidden className="size-3.5" /> แชร์ QR สมัคร
    </Link>
  ) : null;
}
```

Place this block immediately after the header `<div className="flex items-center gap-3">...</div>` — there is no `{placing && onPlaceHere ? ... : null}` block left to anchor against at this point in the file, since this same task deletes it (see the note above Step 3's `TeamCard` props). The new door renders for every zero-count firm card regardless of expand state.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/team-map-crew-manage.test.tsx tests/unit/team-map-legibility.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: green except the pre-existing `tests/unit/team-map-plan.test.tsx` (its placing/day-plan-tray assertions now fail because this task deletes that code from `team-map-view.tsx`; Task 8 rebuilds the equivalent behavior in `plan-tab.tsx` and updates or relocates this test then — leave it red in the interim, do not patch it here) — confirm every OTHER failure is fixed (grep remaining files for `ทีมช่าง` region queries and update them the same way: `team-map-gate.test.tsx` if it references the region name anywhere).

- [ ] **Step 6: Commit**

```bash
git add src/components/features/team-map/team-map-view.tsx tests/unit/team-map-crew-manage.test.tsx tests/unit/team-map-legibility.test.tsx tests/unit/team-map-gate.test.tsx
git commit -m "feat(team-map): split ทีมช่าง into ทีมภายใน (crews) + ทีมภายนอก (firms); zero-worker firm gets a QR-only door"
```

---

## U2 — Fix-list

### Task 6: `fix-list.ts` — pure derivation

**Files:**

- Create: `src/lib/team-map/fix-list.ts`
- Test: `tests/unit/fix-list.test.ts`

**Interfaces:**

- Consumes: `ProjectTeamMap` (from Task 1's `build-team-map.ts`, unchanged shape), `UNASSIGNED_TEAM_ID` (Task 1).
- Produces:

```ts
export type FixListItemKind = "unassigned" | "leadless-crew" | "empty-firm";

export interface FixListItem {
  kind: FixListItemKind;
  /** The TeamMapTeamCard.id to expand when this item is tapped. */
  teamId: string;
  label: string;
}

export function deriveTeamMapFixList(map: ProjectTeamMap): FixListItem[];
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fix-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveTeamMapFixList } from "@/lib/team-map/fix-list";
import { UNASSIGNED_TEAM_ID, type ProjectTeamMap } from "@/lib/team-map/build-team-map";

function map(overrides: Partial<ProjectTeamMap> = {}): ProjectTeamMap {
  return {
    management: [],
    site: [],
    teams: [],
    crewTotal: 0,
    teamCount: 0,
    memberCount: 0,
    ...overrides,
  };
}

describe("deriveTeamMapFixList (spec 365 U2)", () => {
  it("all clear → empty list", () => {
    expect(
      deriveTeamMapFixList(
        map({
          teams: [
            {
              kind: "crew",
              id: "cr-1",
              name: "ทีมปูน",
              count: 1,
              members: [{ workerId: "w-1", name: "แก้ว", isTeamLead: true, contractorId: null }],
            },
            {
              kind: "firm",
              id: "f-1",
              name: "ช่างอวย",
              count: 1,
              members: [{ workerId: "w-2", name: "อวย", isTeamLead: false, contractorId: "f-1" }],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("unassigned pool present → one line, first in the list", () => {
    const items = deriveTeamMapFixList(
      map({
        teams: [
          {
            kind: "unassigned",
            id: UNASSIGNED_TEAM_ID,
            name: "ยังไม่จัดทีม",
            count: 8,
            members: [],
          },
          {
            kind: "crew",
            id: "cr-1",
            name: "ทีมปูน",
            count: 1,
            members: [{ workerId: "w-1", name: "แก้ว", isTeamLead: true, contractorId: null }],
          },
        ],
      }),
    );
    expect(items[0]).toEqual({
      kind: "unassigned",
      teamId: UNASSIGNED_TEAM_ID,
      label: "8 คนยังไม่มีทีม",
    });
  });

  it("a crew with no lead → one line naming that team", () => {
    const items = deriveTeamMapFixList(
      map({
        teams: [
          {
            kind: "crew",
            id: "cr-1",
            name: "ทีม ช จันทร์",
            count: 2,
            members: [
              { workerId: "w-1", name: "จันทร์", isTeamLead: false, contractorId: null },
              { workerId: "w-2", name: "ภานุพงษ์", isTeamLead: false, contractorId: null },
            ],
          },
        ],
      }),
    );
    expect(items).toEqual([
      { kind: "leadless-crew", teamId: "cr-1", label: "ทีม ช จันทร์ ยังไม่มีหัวหน้าทีม" },
    ]);
  });

  it("an EMPTY crew (no members at all) is NOT flagged leadless — that is a different, pre-existing empty state", () => {
    const items = deriveTeamMapFixList(
      map({ teams: [{ kind: "crew", id: "cr-1", name: "ทีมใหม่", count: 0, members: [] }] }),
    );
    expect(items).toEqual([]);
  });

  it("a firm with zero members → one line naming that firm", () => {
    const items = deriveTeamMapFixList(
      map({ teams: [{ kind: "firm", id: "f-1", name: "บริษัทว่าง", count: 0, members: [] }] }),
    );
    expect(items).toEqual([
      { kind: "empty-firm", teamId: "f-1", label: "บริษัทว่าง ยังไม่มีรายชื่อ" },
    ]);
  });

  it("order: unassigned first, then leadless crews, then empty firms", () => {
    const items = deriveTeamMapFixList(
      map({
        teams: [
          { kind: "firm", id: "f-1", name: "บ.หนึ่ง", count: 0, members: [] },
          {
            kind: "crew",
            id: "cr-1",
            name: "ทีมหนึ่ง",
            count: 1,
            members: [{ workerId: "w-1", name: "ก", isTeamLead: false, contractorId: null }],
          },
          {
            kind: "unassigned",
            id: UNASSIGNED_TEAM_ID,
            name: "ยังไม่จัดทีม",
            count: 3,
            members: [],
          },
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["unassigned", "leadless-crew", "empty-firm"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/fix-list.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/team-map/fix-list.ts`:

```ts
// Spec 365 U2 — the fix-list: exactly three conditions, each 100% derivable
// from the already-loaded ProjectTeamMap. Nothing here parses the paper daily
// report; a firm/trade with zero rows in the database is invisible to this
// function BY DESIGN (see the spec's "no fourth condition" note) — the
// standing "+ เพิ่มผู้รับเหมาช่วง" door is the answer for that case, not a
// fix-list item.
import type { ProjectTeamMap } from "./build-team-map";

export type FixListItemKind = "unassigned" | "leadless-crew" | "empty-firm";

export interface FixListItem {
  kind: FixListItemKind;
  teamId: string;
  label: string;
}

export function deriveTeamMapFixList(map: ProjectTeamMap): FixListItem[] {
  const items: FixListItem[] = [];

  const unassigned = map.teams.find((t) => t.kind === "unassigned");
  if (unassigned && unassigned.count > 0) {
    items.push({
      kind: "unassigned",
      teamId: unassigned.id,
      label: `${unassigned.count} คนยังไม่มีทีม`,
    });
  }

  // A crew with NO members at all is a different, pre-existing empty state
  // ("ยังไม่มีสมาชิก" on the card itself) — only a crew that HAS members but
  // none marked isTeamLead counts as "leadless" here, matching the existing
  // card-level "ยังไม่ตั้งหัวหน้าทีม" prompt's own guard exactly.
  for (const t of map.teams) {
    if (t.kind === "crew" && t.members.length > 0 && !t.members.some((m) => m.isTeamLead)) {
      items.push({
        kind: "leadless-crew",
        teamId: t.id,
        label: `ทีม ${t.name} ยังไม่มีหัวหน้าทีม`,
      });
    }
  }

  for (const t of map.teams) {
    if (t.kind === "firm" && t.count === 0) {
      items.push({ kind: "empty-firm", teamId: t.id, label: `${t.name} ยังไม่มีรายชื่อ` });
    }
  }

  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/fix-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-check**

Temporarily invert the leadless-crew guard (`!t.members.some(...)` → `t.members.some(...)`), confirm the suite reds, then restore. Temporarily change `count === 0` to `count >= 0` for the empty-firm branch, confirm the "all clear" test reds (a non-empty firm would now also be flagged), then restore.

- [ ] **Step 6: Commit**

```bash
git add src/lib/team-map/fix-list.ts tests/unit/fix-list.test.ts
git commit -m "feat(team-map): pure fix-list derivation (unassigned / leadless crew / empty firm)"
```

---

### Task 7: `fix-list-card.tsx` + wire into the view

**Files:**

- Create: `src/components/features/team-map/fix-list-card.tsx`
- Test: `tests/unit/fix-list-card.test.tsx`
- Modify: `src/components/features/team-map/team-map-view.tsx`

**Interfaces:**

- Consumes: `FixListItem[]` (Task 6), `toggle(id: string)` and `setExpanded` (existing, in `team-map-view.tsx`).
- Produces: `<FixListCard items={...} onOpen={(teamId) => void} />`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fix-list-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FixListCard } from "@/components/features/team-map/fix-list-card";
import type { FixListItem } from "@/lib/team-map/fix-list";

const ITEMS: FixListItem[] = [
  { kind: "unassigned", teamId: "unassigned", label: "8 คนยังไม่มีทีม" },
  { kind: "leadless-crew", teamId: "cr-1", label: "ทีม ช จันทร์ ยังไม่มีหัวหน้าทีม" },
  { kind: "empty-firm", teamId: "f-1", label: "บริษัทว่าง ยังไม่มีรายชื่อ" },
];

describe("FixListCard (spec 365 U2)", () => {
  it("renders nothing when the list is empty", () => {
    const { container } = render(<FixListCard items={[]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every item as a full-width tap target with its label", () => {
    render(<FixListCard items={ITEMS} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /8 คนยังไม่มีทีม/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ทีม ช จันทร์ ยังไม่มีหัวหน้าทีม/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /บริษัทว่าง ยังไม่มีรายชื่อ/ })).toBeInTheDocument();
  });

  it("tapping an item calls onOpen with its teamId", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<FixListCard items={ITEMS} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: /ทีม ช จันทร์/ }));
    expect(onOpen).toHaveBeenCalledWith("cr-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/fix-list-card.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/features/team-map/fix-list-card.tsx`:

```tsx
"use client";

// Spec 365 U2 — the top-of-page fix-list card. One tap target per item;
// renders nothing when the list is empty (never a persistent empty banner).
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { FixListItem } from "@/lib/team-map/fix-list";

export function FixListCard({
  items,
  onOpen,
}: {
  items: FixListItem[];
  onOpen: (teamId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-attn bg-attn-soft rounded-card mb-3 flex flex-col gap-1 border p-3">
      <p className="text-attn-ink flex items-center gap-1.5 text-xs font-semibold">
        <AlertTriangle aria-hidden className="size-3.5" /> ต้องแก้ไข {items.length} รายการ
      </p>
      {items.map((item) => (
        <button
          key={`${item.kind}-${item.teamId}`}
          type="button"
          onClick={() => onOpen(item.teamId)}
          className="text-attn-ink flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm"
        >
          {item.label}
          <ChevronRight aria-hidden className="size-4 shrink-0" />
        </button>
      ))}
    </div>
  );
}
```

**Verified**: `border-attn bg-attn-soft text-attn-ink` is the real, established house pattern for an attention/warning surface (`src/app/globals.css` defines `--color-attn`/`--color-attn-soft`/`--color-attn-edge`/`--color-attn-ink`; the exact triplet above is already used verbatim in `sandbox-banner.tsx`, `view-as-banner.tsx`, `view-as-empty-note.tsx`, `review-queue-list.tsx`) — the classes in the snippet above are correct as written, no substitution needed.

Wire it into `team-map-view.tsx`: add the import, derive the list, and render it once, above the สนับสนุน section:

```ts
import { deriveTeamMapFixList } from "@/lib/team-map/fix-list";
import { FixListCard } from "./fix-list-card";
```

```ts
const fixListItems = useMemo(() => deriveTeamMapFixList(map), [map]);
const onOpenFixListItem = (teamId: string) => {
  setExpanded((prev) => new Set(prev).add(teamId));
  // Best-effort scroll; the card already renders once expanded is set, so
  // this runs on the NEXT frame via a rAF to let the DOM update first.
  requestAnimationFrame(() => {
    document.getElementById(`team-card-${teamId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
};
```

Add `id={`team-card-${team.id}`}` alongside the existing `data-testid={`team-card-${team.id}`}` on `TeamCard`'s root `<div>` (Task 4/5 territory — a one-line addition to the same element).

Render `<FixListCard items={fixListItems} onOpen={onOpenFixListItem} />` as the first child inside the outermost `<div className="flex flex-col">`, before the สนับสนุน section.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/fix-list-card.test.tsx tests/unit/team-map-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: RTL — wire-up test in team-map-view**

Add to `tests/unit/team-map-view.test.tsx`:

```ts
it("the fix-list opens and scrolls to the leadless crew it names", async () => {
  const user = userEvent.setup();
  renderView({
    ...MAP,
    teams: [
      {
        kind: "crew",
        id: "cr-leadless",
        name: "ทีมไร้หัวหน้า",
        count: 1,
        members: [{ workerId: "w-x", name: "คนหนึ่ง", isTeamLead: false, contractorId: null }],
      },
    ],
  });
  await user.click(screen.getByRole("button", { name: /ทีมไร้หัวหน้า ยังไม่มีหัวหน้าทีม/ }));
  expect(screen.getByText("ทีมไร้หัวหน้า")).toBeInTheDocument();
  // Expanded: the "ยังไม่ตั้งหัวหน้าทีม" prompt is now visible (card opened).
  expect(screen.queryByText(/ยังไม่ตั้งหัวหน้าทีม/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Full suite + typecheck + build**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/components/features/team-map/fix-list-card.tsx tests/unit/fix-list-card.test.tsx src/components/features/team-map/team-map-view.tsx tests/unit/team-map-view.test.tsx
git commit -m "feat(team-map): wire the fix-list card into the page, tap-to-expand"
```

---

## U3 — Plan-tab split

### Task 8: Extract `plan-tab.tsx`

**Files:**

- Create: `src/components/features/team-map/plan-tab.tsx`
- Create: `tests/unit/plan-tab.test.tsx`
- Modify (delete plan-specific cases, replaced by the new file): `tests/unit/team-map-plan.test.tsx`

**Interfaces:**

- Consumes: `TeamMapDayPlan`, `DayPlanWpItem`, `TeamDayAssignment`, `PlanWpOption` (existing types, unchanged), `TeamMapTeamCard[]` (crews only — the compact drop-target list), `leadTradesOf` and `TIER_ACTION_BASE`/`TIER_ACTION`/`SHEET_ACTION` (Task 3 — import from `@/lib/team-map/trade-hint` and `./action-classes`, do not redefine).
- Produces:

```tsx
export function PlanTab({
  projectId,
  crews,
  dayPlans,
  planWps,
  tradesByWorker,
  onOpenWorkPackage,
}: {
  projectId: string;
  /** ทีมภายใน crews ONLY — firms/pool are never plan-assignment targets. */
  crews: TeamMapTeamCard[];
  dayPlans: { today: TeamMapDayPlan; tomorrow: TeamMapDayPlan };
  planWps: PlanWpOption[];
  tradesByWorker?: Record<string, WorkerTrade[]>;
  onOpenWorkPackage: (workPackageId: string) => void;
}): JSX.Element;
```

This task is the largest single extraction. Rather than re-deriving every line from scratch, move the EXISTING code verbatim, adjusting only what changed shape (props instead of closure-captured parent state) and adding the new compact crew list as the placing-mode drop target (replacing the old `TeamCard`-with-`onPlaceHere` mechanism, per the operator's locked resolution).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plan-tab.test.tsx`. Port the existing plan-related cases from `tests/unit/team-map-plan.test.tsx` (read that file's full 307 lines first — `pnpm exec vitest run tests/unit/team-map-plan.test.tsx` won't help here since we're PORTING, not running; use `Read` on the file), adapting each `render(<TeamMapView ... />)` call to `render(<PlanTab ... />)` with the narrower prop set above. At minimum, include:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mockApplyPlanSuggestions = vi.fn(async () => ({ ok: true }));
const mockAddDailyPlanItem = vi.fn(async () => ({ ok: true }));
const mockSetDailyPlanItemCrew = vi.fn(async () => ({ ok: true }));
vi.mock("@/app/sa/plan/actions", () => ({
  applyPlanSuggestions: (...args: unknown[]) => mockApplyPlanSuggestions(...args),
  addDailyPlanItem: (...args: unknown[]) => mockAddDailyPlanItem(...args),
  setDailyPlanItemCrew: (...args: unknown[]) => mockSetDailyPlanItemCrew(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { PlanTab } from "@/components/features/team-map/plan-tab";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const CREWS = [
  {
    kind: "crew" as const,
    id: "cr-1",
    name: "ทีมปูน",
    count: 1,
    members: [{ workerId: "w-lead", name: "แก้ว", isTeamLead: true, contractorId: null }],
  },
  {
    kind: "crew" as const,
    id: "cr-2",
    name: "ทีมเหล็ก",
    count: 1,
    members: [{ workerId: "w-lead2", name: "สมหวัง", isTeamLead: true, contractorId: null }],
  },
];
const EMPTY_DAY = { date: "2026-07-27", items: [] };

function renderTab(overrides: Partial<Parameters<typeof PlanTab>[0]> = {}) {
  return render(
    <PlanTab
      projectId={PROJECT}
      crews={CREWS}
      dayPlans={{ today: EMPTY_DAY, tomorrow: EMPTY_DAY }}
      planWps={[]}
      onOpenWorkPackage={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PlanTab (spec 365 U3)", () => {
  it("renders the compact crew list as drop targets — name + count only, no chips", () => {
    renderTab();
    expect(screen.getByText("ทีมปูน")).toBeInTheDocument();
    expect(screen.getByText("ทีมเหล็ก")).toBeInTheDocument();
    // No member chip name should leak into this compact list.
    expect(screen.queryByText("แก้ว")).not.toBeInTheDocument();
  });

  it("today/tomorrow toggle switches the rendered tray", async () => {
    const user = userEvent.setup();
    renderTab({
      dayPlans: {
        today: {
          date: "2026-07-27",
          items: [
            {
              workPackageId: "wp-1",
              itemId: "i-1",
              code: "W01-01",
              name: "งานหนึ่ง",
              categoryCode: null,
            },
          ],
        },
        tomorrow: EMPTY_DAY,
      },
    });
    expect(screen.getByText("W01-01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "พรุ่งนี้" }));
    expect(screen.queryByText("W01-01")).not.toBeInTheDocument();
  });

  it("picking up a tray item then tapping a compact crew row assigns it", async () => {
    const user = userEvent.setup();
    renderTab({
      dayPlans: {
        today: {
          date: "2026-07-27",
          items: [
            {
              workPackageId: "wp-1",
              itemId: "i-1",
              code: "W01-01",
              name: "งานหนึ่ง",
              categoryCode: null,
            },
          ],
        },
        tomorrow: EMPTY_DAY,
      },
    });
    await user.click(screen.getByRole("button", { name: /W01-01/ }));
    await user.click(
      screen.getByRole("button", { name: /วางที่ทีมนี้.*ทีมปูน|ทีมปูน.*วางที่ทีมนี้/ }),
    );
    expect(mockApplyPlanSuggestions).toHaveBeenCalledWith(PROJECT, "2026-07-27", [
      { wp: "wp-1", crew: { workerIds: ["w-lead"], lead: "w-lead" } },
    ]);
  });
});
```

Adjust the exact button `name` regex in the third test once Step 3's compact-row markup is written (the plan below renders `วางที่ทีมนี้` and the crew name as SEPARATE elements inside one button — use `within(screen.getByTestId("plan-drop-cr-1")).getByRole("button")` instead if a combined accessible-name match proves awkward).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/plan-tab.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/features/team-map/plan-tab.tsx`, moving the following pieces out of `team-map-view.tsx` nearly verbatim: the `day`/`placing` state, `switchDay`, `teamGrainCrew`, `placeOnTeam`, the tray JSX (today's lines 684–760), the `addPlanWp` sheet (1107–1151), and the `planChip` sheet (1038–1105) — all parameterized on the new props instead of closures over `map`/`projectId` from the parent. Replace the OLD placing-mode `TeamCard` drop target with a compact list:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, MapPin } from "lucide-react";
import {
  addDailyPlanItem,
  applyPlanSuggestions,
  setDailyPlanItemCrew,
} from "@/app/sa/plan/actions";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { CategoryChip } from "@/components/features/work-packages/category-chip";
import {
  buildDayAssignments,
  type DayPlanWpItem,
  type TeamDayAssignment,
  type TeamMapDayPlan,
} from "@/lib/work-plans/day-assignments";
import { leadTradesOf } from "@/lib/team-map/trade-hint";
import { tradeMismatchCode, type WorkerTrade } from "@/lib/workers/trades";
import type { TeamMapTeamCard } from "@/lib/team-map/build-team-map";
import { TRADE_MISMATCH_HINT } from "@/lib/i18n/labels";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { TIER_ACTION_BASE, TIER_ACTION, SHEET_ACTION } from "./action-classes";

export interface PlanWpOption {
  id: string;
  code: string;
  name: string;
}

export function PlanTab({
  projectId,
  crews,
  dayPlans,
  planWps,
  tradesByWorker,
  onOpenWorkPackage,
}: {
  projectId: string;
  crews: TeamMapTeamCard[];
  dayPlans: { today: TeamMapDayPlan; tomorrow: TeamMapDayPlan };
  planWps: PlanWpOption[];
  tradesByWorker?: Record<string, WorkerTrade[]>;
  onOpenWorkPackage: (workPackageId: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [placing, setPlacing] = useState<DayPlanWpItem | null>(null);
  const [addWpOpen, setAddWpOpen] = useState(false);
  const [planChipTarget, setPlanChipTarget] = useState<{
    entry: TeamDayAssignment;
    team: TeamMapTeamCard;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planDate = dayPlans[day].date;
  const assignments = useMemo(
    () => buildDayAssignments(dayPlans[day].items, crews),
    [dayPlans, day, crews],
  );

  function teamGrainCrew(team: TeamMapTeamCard) {
    const members = team.members.filter((m) => m.contractorId === null);
    return {
      workerIds: members.map((m) => m.workerId),
      lead: members.find((m) => m.isTeamLead)?.workerId ?? null,
    };
  }

  function switchDay(next: "today" | "tomorrow") {
    setDay(next);
    setPlacing(null);
  }

  function placeOnTeam(team: TeamMapTeamCard) {
    if (!placing) return;
    const item = placing;
    setPlacing(null);
    setBusy(true);
    void (async () => {
      try {
        const r = await applyPlanSuggestions(projectId, planDate, [
          { wp: item.workPackageId, crew: teamGrainCrew(team) },
        ]);
        if (!r.ok) {
          toast.error(r.error ?? "มอบงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          return;
        }
        toast.success("มอบงานแล้ว");
        router.refresh();
      } catch {
        toast.error("มอบงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      } finally {
        setBusy(false);
      }
    })();
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const r = await action();
        if (!r.ok) {
          setError(r.error ?? "ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          return;
        }
        toast.success(done);
        setPlanChipTarget(null);
        setAddWpOpen(false);
        router.refresh();
      } catch {
        setError("ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-3">
      <div data-testid="wp-tray" className="border-edge-strong rounded-lg border border-dashed p-2">
        <div className="mb-1.5 flex items-center gap-2">
          <Inbox aria-hidden className="text-ink-secondary size-4 shrink-0" />
          <span className="text-ink-secondary min-w-0 flex-1 truncate text-xs font-medium">
            งานที่ยังไม่มอบทีม
          </span>
          <div className="flex gap-1" role="group" aria-label="เลือกวัน">
            <button
              type="button"
              aria-pressed={day === "today"}
              className={`${TIER_ACTION_BASE} ${day === "today" ? "text-action" : "text-ink-secondary"}`}
              onClick={() => switchDay("today")}
            >
              วันนี้
            </button>
            <button
              type="button"
              aria-pressed={day === "tomorrow"}
              className={`${TIER_ACTION_BASE} ${day === "tomorrow" ? "text-action" : "text-ink-secondary"}`}
              onClick={() => switchDay("tomorrow")}
            >
              พรุ่งนี้
            </button>
          </div>
          <button type="button" className={TIER_ACTION} onClick={() => setAddWpOpen(true)}>
            เพิ่มงานเข้าแผน
          </button>
        </div>
        {placing ? (
          <p className="text-action mb-1.5 text-xs">
            กำลังมอบ {placing.code} — แตะทีมที่จะรับงานด้านล่าง
            <button
              type="button"
              className="text-ink-secondary ml-2 underline"
              onClick={() => setPlacing(null)}
            >
              ยกเลิก
            </button>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {assignments.tray.map((item) => (
            <button
              key={item.itemId}
              type="button"
              className={`bg-card text-ink inline-flex min-h-11 items-center gap-1 rounded-lg border px-2.5 text-xs ${
                placing?.itemId === item.itemId ? "border-edge-strong" : "border-edge"
              }`}
              onClick={() => setPlacing((cur) => (cur?.itemId === item.itemId ? null : item))}
            >
              <MapPin aria-hidden className="text-ink-secondary size-3" />
              <span className="font-medium">{item.code}</span>
              <span className="text-ink-secondary max-w-32 truncate">{item.name}</span>
            </button>
          ))}
          {assignments.tray.length === 0 ? (
            <span className="text-ink-muted text-xs">
              ไม่มีงานค้างมอบ{day === "today" ? "วันนี้" : "พรุ่งนี้"}
            </span>
          ) : null}
        </div>
        {assignments.individual.length > 0 ? (
          <p className="text-ink-muted mt-1.5 text-xs">
            มีอีก {assignments.individual.length} งานที่จัดคนไว้แบบอื่น — ดูที่แผนงาน
          </p>
        ) : null}
      </div>

      {/* Spec 365 U3 — compact drop-target list. ทีมภายใน crews ONLY (never a
          firm or the unassigned pool); no chips, no manage button — the full
          card lives on the ทีมงาน tab. */}
      <div className="flex flex-col gap-1.5">
        {crews.map((team) => {
          const chips = assignments.byTeam.get(team.id) ?? [];
          const mismatch = placing
            ? tradeMismatchCode(placing.categoryCode, leadTradesOf(team, tradesByWorker))
            : null;
          return (
            <div
              key={team.id}
              data-testid={`plan-drop-${team.id}`}
              className="border-edge bg-card flex flex-col gap-1 rounded-lg border px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink text-sm font-medium">
                  {team.name} <span className="text-ink-secondary text-xs">· {team.count} คน</span>
                </span>
                {placing ? (
                  <button
                    type="button"
                    className="border-edge-strong text-action min-h-11 rounded-lg border border-dashed px-2.5 text-xs font-medium"
                    onClick={() => placeOnTeam(team)}
                  >
                    <MapPin aria-hidden className="mr-1 inline size-3.5" /> วางที่ทีมนี้
                  </button>
                ) : null}
              </div>
              {placing && mismatch ? (
                <p className="text-ink-muted flex items-center gap-1.5 text-xs">
                  <CategoryChip code={mismatch} /> {TRADE_MISMATCH_HINT}
                </p>
              ) : null}
              {chips.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((entry) => (
                    <button
                      key={entry.item.itemId}
                      type="button"
                      className="bg-sunk text-ink inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs"
                      onClick={() => setPlanChipTarget({ entry, team })}
                    >
                      <MapPin aria-hidden className="text-ink-secondary size-3" />
                      <span className="font-medium">{entry.item.code}</span>
                      <span className="text-ink-secondary max-w-32 truncate">
                        {entry.item.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <BottomSheet
        open={planChipTarget !== null}
        title={
          planChipTarget ? `${planChipTarget.entry.item.code} · ${planChipTarget.team.name}` : ""
        }
        onClose={() => setPlanChipTarget(null)}
      >
        {planChipTarget ? (
          <div className="flex flex-col gap-2">
            <p className="text-ink-secondary text-xs">{planChipTarget.entry.item.name}</p>
            {(() => {
              const mm = tradeMismatchCode(
                planChipTarget.entry.item.categoryCode,
                leadTradesOf(planChipTarget.team, tradesByWorker),
              );
              return mm ? (
                <p className="text-ink-muted flex items-center gap-1.5 text-xs">
                  <CategoryChip code={mm} /> {TRADE_MISMATCH_HINT}
                </p>
              ) : null;
            })()}
            {planChipTarget.entry.mixed ? (
              <p className="text-ink-secondary text-sm">งานนี้จัดคนรายบุคคลไว้ — แก้ได้ที่แผนงาน</p>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className={SHEET_ACTION}
                  onClick={() => {
                    const item = planChipTarget.entry.item;
                    setPlanChipTarget(null);
                    setPlacing(item);
                  }}
                >
                  <MapPin aria-hidden className="text-ink-secondary size-4" /> ย้ายไปทีมอื่น
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={SHEET_ACTION}
                  onClick={() =>
                    run(
                      () => setDailyPlanItemCrew(planChipTarget.entry.item.itemId, [], null),
                      "เอางานออกจากทีมแล้ว",
                    )
                  }
                >
                  เอาออกจากทีม
                </button>
              </>
            )}
            <button
              type="button"
              className={SHEET_ACTION}
              onClick={() => onOpenWorkPackage(planChipTarget.entry.item.workPackageId)}
            >
              เปิดหน้างาน
            </button>
            {error ? <p className={INLINE_ERROR}>{error}</p> : null}
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={addWpOpen}
        title={`เพิ่มงานเข้าแผน${day === "today" ? "วันนี้" : "พรุ่งนี้"}`}
        onClose={() => setAddWpOpen(false)}
      >
        <div className="flex flex-col gap-2">
          {(() => {
            const onBoard = new Set(dayPlans[day].items.map((i) => i.workPackageId));
            const offerable = planWps.filter((wp) => !onBoard.has(wp.id));
            return (
              <>
                {offerable.map((wp) => (
                  <button
                    key={wp.id}
                    type="button"
                    disabled={busy}
                    className={SHEET_ACTION}
                    onClick={() =>
                      run(() => addDailyPlanItem(projectId, planDate, wp.id), "เพิ่มงานเข้าแผนแล้ว")
                    }
                  >
                    <span className="font-medium">{wp.code}</span>
                    <span className="text-ink-secondary min-w-0 flex-1 truncate text-xs">
                      {wp.name}
                    </span>
                  </button>
                ))}
                {offerable.length === 0 ? (
                  <p className="text-ink-muted text-xs">ไม่มีงานให้เพิ่ม</p>
                ) : null}
              </>
            );
          })()}
          {error ? <p className={INLINE_ERROR}>{error}</p> : null}
        </div>
      </BottomSheet>
    </div>
  );
}
```

**Verified** (`src/lib/work-plans/day-assignments.ts:63`): `buildDayAssignments` filters its `teams` argument to `kind === "crew"` internally before doing anything else, and neither `individual` nor `tray` reads firm/pool cards at all — passing `crews`-only from `PlanTab` is exactly equivalent to today's full-`map.teams` call, no adjustment needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/plan-tab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Remove the ported cases from `team-map-plan.test.tsx`**

Delete every test in `tests/unit/team-map-plan.test.tsx` that is now covered by `plan-tab.test.tsx` (the tray, day-toggle, placing, planChip-sheet, addPlanWp-sheet cases). Keep only cases that test something ELSE about `TeamMapView` incidentally through the plan props (if any remain after the port, re-home them too — the goal is zero test overlap between the two files). If the file becomes empty, delete it.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/team-map/plan-tab.tsx tests/unit/plan-tab.test.tsx tests/unit/team-map-plan.test.tsx
git commit -m "feat(team-map): extract PlanTab — compact crew list replaces full-card drop targets"
```

---

### Task 9: Wire the two tabs into `team-map-view.tsx`

**Files:**

- Modify: `src/components/features/team-map/team-map-view.tsx`
- Modify: `src/app/projects/[projectId]/team/page.tsx` (pass `planWps`/`dayPlans` straight through unchanged — only the render split moves)

**Interfaces:**

- Consumes: `PlanTab` (Task 8).
- Produces: a tab strip (`ทีมงาน` | `แผนงานวันนี้ (N ทีมยังไม่ตั้งงาน)`) at the top of the return, gating which section renders.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/team-map-view.test.tsx`:

```ts
  it("two tabs: ทีมงาน (default) and แผนงานวันนี้ with the unassigned-team count", () => {
    render(
      <TeamMapView
        projectId={PROJECT}
        map={MAP}
        addableStaff={[]}
        currentUserId="u-pm"
        dayPlans={{
          today: { date: "2026-07-27", items: [] },
          tomorrow: { date: "2026-07-28", items: [] },
        }}
        planWps={[]}
      />,
    );
    expect(screen.getByRole("tab", { name: "ทีมงาน" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /แผนงานวันนี้/ })).toBeInTheDocument();
  });

  it("switching to the plan tab hides the ทีมภายใน/ทีมภายนอก/สนับสนุน sections and shows PlanTab", async () => {
    const user = userEvent.setup();
    render(
      <TeamMapView
        projectId={PROJECT}
        map={MAP}
        addableStaff={[]}
        currentUserId="u-pm"
        dayPlans={{
          today: { date: "2026-07-27", items: [] },
          tomorrow: { date: "2026-07-28", items: [] },
        }}
        planWps={[]}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /แผนงานวันนี้/ }));
    expect(screen.queryByRole("region", { name: "สนับสนุน" })).not.toBeInTheDocument();
    expect(screen.getByTestId("wp-tray")).toBeInTheDocument();
  });

  it("without dayPlans/planWps, only the ทีมงาน tab renders — no tab strip at all", () => {
    renderView();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/team-map-view.test.tsx`
Expected: FAIL — no tab role exists yet.

- [ ] **Step 3: Write minimal implementation**

In `team-map-view.tsx`, add tab state and the strip. Only render tabs at all when `dayPlans` is provided (matching today's existing "the whole plan layer is optional" contract):

```ts
const [activeTab, setActiveTab] = useState<"structure" | "plan">("structure");
```

Wrap the return's existing JSX body (everything from `<FixListCard .../>` through the สนับสนุน/ทีมภายใน/ทีมภายนอก sections) in a conditional, and add the tab strip + `PlanTab` render:

```tsx
return (
  <div className="flex flex-col">
    {dayPlans ? (
      <div role="tablist" className="border-edge mb-3 flex gap-1 border-b">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "structure"}
          className={`min-h-11 border-b-2 px-3 text-sm font-medium ${
            activeTab === "structure"
              ? "border-action text-action"
              : "text-ink-secondary border-transparent"
          }`}
          onClick={() => setActiveTab("structure")}
        >
          ทีมงาน
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "plan"}
          className={`min-h-11 border-b-2 px-3 text-sm font-medium ${
            activeTab === "plan"
              ? "border-action text-action"
              : "text-ink-secondary border-transparent"
          }`}
          onClick={() => setActiveTab("plan")}
        >
          แผนงานวันนี้
          {unassignedTeamsToday > 0 ? ` (${unassignedTeamsToday} ทีมยังไม่ตั้งงาน)` : ""}
        </button>
      </div>
    ) : null}

    {!dayPlans || activeTab === "structure" ? (
      <>
        <FixListCard items={fixListItems} onOpen={onOpenFixListItem} />
        {/* สนับสนุน / ทีมภายใน / ทีมภายนอก sections, unchanged from Task 4/5 */}
        ...
      </>
    ) : null}

    {dayPlans && activeTab === "plan" ? (
      <PlanTab
        projectId={projectId}
        crews={crewCards}
        dayPlans={dayPlans}
        planWps={planWps ?? []}
        {...(tradesByWorker ? { tradesByWorker } : {})}
        onOpenWorkPackage={(wpId) => router.push(`/projects/${projectId}/work-packages/${wpId}`)}
      />
    ) : null}

    {/* sheets that are NOT plan-related (staff, add, createCrew, chip, info,
          confirmDissolve, confirmSelfRemove) stay HERE, rendered unconditionally
          regardless of activeTab, unchanged from their current position. */}
  </div>
);
```

Define `unassignedTeamsToday` from the SAME `buildDayAssignments` computation `PlanTab` does internally — since the parent needs the count for the tab label BEFORE `PlanTab` mounts (it must show even while `activeTab === "structure"`), compute it once at this level too. **Verified** (`day-assignments.ts:83-85`): `byTeam` only gains a key for a crew when at least one item overlaps it, so `byTeam.size` is exactly "crews with ≥1 assigned WP today" and `crewCards.length - byTeam.size` is exactly "crews with zero" — no placeholder, this is the real derivation:

```ts
const unassignedTeamsToday = useMemo(() => {
  if (!dayPlans) return 0;
  const todayAssignments = buildDayAssignments(dayPlans.today.items, crewCards);
  return crewCards.length - todayAssignments.byTeam.size;
}, [dayPlans, crewCards]);
```

(This duplicate computation is intentional and cheap — `buildDayAssignments` is a pure, small function; re-running it once in the parent for the tab-label count avoids threading state up out of `PlanTab`, keeping that component self-contained.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/team-map-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, build, guard suites**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green.

Run the guard suites explicitly (they fail CI silently otherwise): `pnpm exec vitest run tests/unit/design-doctrine.test.ts tests/unit/feature-components-structure.test.ts tests/unit/ui-class-contracts.test.tsx` (confirm these exact filenames exist first via `ls tests/unit | grep -E "design-doctrine|feature-components-structure|ui-class-contracts"` — adjust if named differently).

- [ ] **Step 6: Real-flow verify**

Dev-preview login → `/projects/<pilot project id>/team`. Confirm: fix-list shows the real "8 คนยังไม่มีทีม" line (or whatever the live count is by ship day — re-query first) and nothing else; ทีมภายใน shows the 4 real crews; ทีมภายนอก shows exactly ช่างอวย (verify no OTHER company contractor leaks in); the `แผนงานวันนี้` tab shows its count and, when opened, the compact crew list with no member chips; picking up a tray WP and tapping a crew row still assigns it (if any WPs are on the board that day) or confirm the empty-tray state renders correctly if not. Zero console errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/features/team-map/team-map-view.tsx tests/unit/team-map-view.test.tsx
git commit -m "feat(team-map): wire ทีมงาน/แผนงานวันนี้ tabs; plan layer fully split out"
```

---

## Self-Review (performed before handing this plan back)

**1. Spec coverage:**

- Model/three bands → Tasks 3, 4, 5. ✅
- Firm scoping via `workers.project_id`, never bare `contractors` → Tasks 1, 2. ✅
- Zero-worker firm card, QR-only door → Task 5. ✅
- `+ เพิ่มผู้รับเหมาช่วง` → `/contacts` → Task 5. ✅
- Fix-list, 3 conditions, correct tap-through (expand in place, not a nonexistent sheet) → Tasks 6, 7. ✅
- Plan tab split + resolved drop-target gap (compact crew list) → Tasks 8, 9. ✅
- No schema/RPC touched anywhere → confirmed, every task modifies only `src/lib/team-map/**`, `src/components/features/team-map/**`, and their tests.

**2. Placeholder scan:** No TBD/TODO. Two spots were flagged as "verify before assuming" during the first pass (Task 7's CSS token names, Task 8's `buildDayAssignments` signature) and have since been checked against the live source — both confirmed correct as written (`border-attn bg-attn-soft text-attn-ink` is the real house pattern used verbatim in 4 other components; `buildDayAssignments` already filters to `kind==="crew"` internally, so `crews`-only is exactly equivalent to today's full-array call, and `crewCards.length - byTeam.size` is the exact unassigned-team count). No remaining unverified assumptions.

**3. Type consistency:** `FixListItem`/`FixListItemKind` (Task 6) match between the pure function and `FixListCard`'s props (Task 7). `UNASSIGNED_TEAM_ID` (Task 1) is the single source both `build-team-map.ts` and `fix-list.ts` use. `leadTradesOf`'s signature (Task 3) is identical everywhere it's imported (`team-map-view.tsx`'s `TeamCard`, `plan-tab.tsx`). `PlanTab`'s prop names (`crews`, `dayPlans`, `planWps`, `onOpenWorkPackage`) are used identically in Task 8's test and Task 9's wiring.

**One sequencing note carried from Task 5:** running the full suite strictly green after EVERY individual task requires either building U1+U3 in one sitting (Tasks 1–5 then 8–9 before the first ship) or accepting that `team-map-plan.test.tsx` reds between Task 5 and Task 8. Since the spec itself says all three units are independently shippable, an executor who wants to SHIP U1 alone should reorder: do Task 5's tray/placing removal and Task 8/9's tab extraction in the SAME PR, or hold U1's ship until U3 also lands. Flagging this rather than silently picking one — it is a real sequencing decision, not a plan defect.
