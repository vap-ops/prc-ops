# Spec 313 — Nav redesign implementation plan

> **For agentic workers:** execute unit-by-unit with the repo's `ship-unit` skill (lane claim → dependency gate-check → RED first → real-flow verify → fresh-eyes → gated ship). Each Unit below = ONE PR. Steps use checkbox syntax. This repo's workflow overrides generic executors: TDD is mandatory, every unit ships via `scripts/ship-pr.sh`.

**Goal:** Rebuild internal nav around five domains — new `/team` people hub, SA โครงการ tab direct-landing, ทีมงาน/รายชื่อช่าง/แรงงาน label split, tab-set rebuilds, dead-end role homes, hub promotion — per `313-nav-redesign.md` (operator-approved 2026-07-13).

**Architecture:** No schema, no RLS, no money paths. Only `/sa/crew*` URLs move (→ `/team*`, redirects kept). Everything else is chrome: tab/strip constants, one RSC redirect, labels, guard re-pins.

**Tech stack:** Next 16 App Router (RSC, async searchParams), Vitest + RTL, repo source-string invariant tests.

## Global constraints

- TDD: failing test FIRST in every unit ("Writing failing test first" stated in-session).
- Thai strings: edit ONLY via Edit/Write tools, never PowerShell heredocs (encoding corruption).
- Every Bash command starts with `cd /d/claude/projects/prc-ops/prc-ops`.
- Each unit: `pnpm lint && pnpm typecheck && pnpm test` green + real-flow browser verify (dev-preview login) before ship.
- Nav law (ui-conventions §12) binds: labels from `labels.ts` when used 2+ places; every nav change updates `site-map.md` in the same unit it lands (U1–U6 update their own rows; U7 is the full re-audit).
- Unit order is dependency order: U1 → U2 → U3 → U4 → U5 → U6 → U7. U6 is danger-path (operator-HELD PR).
- Worktree per session; schema lane untouched (no migrations anywhere in this plan).

---

### Unit 1: `/team` hub + `/sa/crew*` redirects + tile retarget

**Files:**

- Create: `src/app/team/page.tsx` (body moved from `src/app/sa/crew/page.tsx` + new sections)
- Create: `src/app/team/badges/page.tsx` (moved verbatim from `src/app/sa/crew/badges/page.tsx`, back chip → `/team`)
- Rewrite as redirect: `src/app/sa/crew/page.tsx`, `src/app/sa/crew/badges/page.tsx`
- Modify: `src/components/features/sa/sa-tools.tsx` (ทีมงาน tile href `/sa/crew` → `/team`)
- Modify: `tests/unit/sa-tools.test.tsx:45`, `tests/unit/nav-back-affordance.test.ts`
- Create: `tests/unit/team-page.test.ts`
- Modify: `docs/site-map.md` (rows for /team, /team/badges, redirects)

**Interfaces:**

- Consumes: `getSaCurrentProject(supabase, ctx.id)` → `{ current: { projectId: string | null } }`; `musterHref(id)` → `/projects/${id}/muster`; existing components `AddTechnicianSheet{projects, qrCards}`, `CrewProgressRoster{data, registrationsHref}`, `SiteTeamBoard{board}`; `listVisibleTechnicianRegistrations(supabase)`.
- Produces: route `/team` (hub, HubNav, no DetailHeader) and `/team/badges` (detail, back → `/team`). Later units point tabs/strips at `/team`.

- [ ] **Step 1: Write the failing test** — `tests/unit/team-page.test.ts` (repo source-string pattern, cf. `requests-primary-tab-nav.test.ts`):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("/team hub (spec 313 U1)", () => {
  it("renders hub chrome: HubNav + BottomTabBar, no DetailHeader", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("HubNav");
    expect(src).toContain("BottomTabBar");
    expect(src).not.toContain("DetailHeader");
  });

  it("gates on the union of site staff + worker-roster roles (no new named set)", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("SITE_STAFF_ROLES");
    expect(src).toContain('"procurement"');
    expect(src).toContain('"procurement_manager"');
  });

  it("fronts the เช็คชื่อ cockpit via musterHref for the crew roles", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("musterHref(");
    expect(src).toContain("MUSTER_LABEL");
  });

  it("shows the คำขอสมัคร queue section only to STAFF_APPROVAL_ROLES", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("STAFF_APPROVAL_ROLES");
    expect(src).toContain('"/registrations"');
  });

  it("keeps /sa/crew and /sa/crew/badges as redirects", () => {
    expect(read("src/app/sa/crew/page.tsx")).toContain('redirect("/team")');
    expect(read("src/app/sa/crew/badges/page.tsx")).toContain('redirect("/team/badges")');
  });
});
```

- [ ] **Step 2: Run it — must FAIL** (`src/app/team/page.tsx` missing):

```
cd /d/claude/projects/prc-ops/prc-ops && pnpm test tests/unit/team-page.test.ts
```

Expected: FAIL — ENOENT `src/app/team/page.tsx`.

- [ ] **Step 3: Create `src/app/team/page.tsx`.** Start from the CURRENT `src/app/sa/crew/page.tsx` body (lines 7–284): keep every import, loader, and builder call verbatim, then apply exactly these changes:

1. Gate (was `requireRole(["site_admin", "super_admin"])`):

```tsx
import { SITE_STAFF_ROLES, STAFF_APPROVAL_ROLES, WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";

// Spec 313 U1: the people-domain hub — union of today's audiences, composed at the
// call site from the existing exported sets (no new named set → no auth-path edit).
const TEAM_PAGE_ROLES = [...new Set([...SITE_STAFF_ROLES, "procurement", "procurement_manager"])] as const;

export default async function TeamPage() {
  const ctx = await requireRole([...TEAM_PAGE_ROLES]);
  const isCrew = ctx.role === "site_admin" || ctx.role === "super_admin";
  const isApprover = STAFF_APPROVAL_ROLES.includes(ctx.role);
  const isBackOffice = WORKER_ROSTER_ROLES.includes(ctx.role);
```

2. Run the existing crew loaders (the `work_packages`-derived `projectIds` fan-out, `sa_worker_bank_status`, `project_site_management`, QR cards, `buildCrewTeams`, `buildSiteTeamBoard`) ONLY when `isCrew` — wrap the whole existing data block in `if (isCrew) { … }` with empty-array defaults above it. Non-crew roles must not run SA-scoped RPCs.

3. Current-project resolution for the เช็คชื่อ CTA (new — the crew page never resolved one):

```tsx
import { getSaCurrentProject } from "@/lib/sa/current-project.server";
import { musterHref } from "@/lib/nav/project-paths";
import { MUSTER_LABEL } from "@/lib/i18n/labels";
import { ScanLine, HardHat, Wallet, UserPlus } from "lucide-react";

const saCurrent = isCrew ? await getSaCurrentProject(supabase, ctx.id) : null;
const musterProjectId = saCurrent?.current.projectId ?? null;
```

4. Approver queue count (new):

```tsx
const pendingCount = isApprover
  ? (await listVisibleTechnicianRegistrations(supabase)).filter((r) => r.status === "pending")
      .length
  : 0;
```

⚠ Gate-check at build time: confirm the live `staff_registrations.status` pending value is `"pending"` (`pnpm exec supabase db query --linked "select distinct status from staff_registrations"`); adjust the literal if the enum differs.

5. Chrome — hub, not detail (replaces `DetailHeader backHref="/sa"`):

```tsx
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="ทีมงาน" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />
      <HubNav items={hubNavForRole(ctx.role) ?? []} currentHref="/team" />
```

⚠ Gate-check `HubNav`'s exact props against `hub-nav.tsx` at HEAD before writing (items/currentHref naming).

6. Body section order (role-gated):

```tsx
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* ① เช็คชื่อ — the attendance front door (spec 313: /team owns the entry;
            the cockpit stays project-scoped). Hidden when no current project. */}
        {isCrew && musterProjectId ? (
          <Link
            href={musterHref(musterProjectId)}
            className="bg-accent text-on-accent flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold"
          >
            <ScanLine aria-hidden className="size-4 shrink-0" />
            {MUSTER_LABEL}
          </Link>
        ) : null}

        {/* ② Crew sections — moved verbatim from /sa/crew (spec 298/306/282/279). */}
        {isCrew && projectList.length > 0 ? (
          <AddTechnicianSheet projects={projectList} qrCards={qrCards} />
        ) : null}
        {isCrew && projectList.length > 0 ? (
          <Link
            href="/team/badges"
            className="border-edge bg-surface text-ink flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold"
          >
            พิมพ์บัตรช่าง (QR)
          </Link>
        ) : null}
        {isCrew ? <CrewProgressRoster data={crewData} registrationsHref="/sa/registrations" /> : null}
        {isCrew ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-body text-ink font-semibold">ทีมหน้างาน</h2>
            <SiteTeamBoard board={siteBoard} />
          </div>
        ) : null}

        {/* ③ คำขอสมัคร queue — approvers only (site_admin is NOT a member; its
            read-only nudge stays on /sa, and the pipeline above already shows รอตรวจ). */}
        {isApprover ? (
          <Link
            href="/registrations"
            className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex items-center gap-3 border px-4 py-3"
          >
            <UserPlus aria-hidden className="text-action size-5 shrink-0" />
            <span className="text-body text-ink min-w-0 flex-1 font-medium">คำขอสมัคร</span>
            {pendingCount > 0 ? (
              <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                {pendingCount}
              </span>
            ) : null}
          </Link>
        ) : null}

        {/* ④ Back-office drill-downs — the roster + wages surfaces keep their URLs. */}
        {isBackOffice ? (
          <div className="grid grid-cols-2 gap-3">
            <Link href="/workers" className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex min-h-11 items-center justify-center gap-2 border px-4 py-3 text-sm font-semibold">
              <HardHat aria-hidden className="size-4 shrink-0" />
              รายชื่อช่าง
            </Link>
            <Link href="/payroll" className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex min-h-11 items-center justify-center gap-2 border px-4 py-3 text-sm font-semibold">
              <Wallet aria-hidden className="size-4 shrink-0" />
              ค่าแรง
            </Link>
          </div>
        ) : null}
      </section>
    </PageShell>
  );
```

`export const metadata = { title: "ทีมงาน" };` stays.

- [ ] **Step 4: Create `src/app/team/badges/page.tsx`** — the current `src/app/sa/crew/badges/page.tsx` verbatim with ONE change: `<DetailHeader backHref="/sa/crew" …>` → `<DetailHeader backHref="/team" backLabel="กลับ">`.

- [ ] **Step 5: Rewrite the two old routes as redirects:**

```tsx
// src/app/sa/crew/page.tsx — spec 313 U1: the crew surface moved to the /team hub.
// Thin redirect kept ≥1 release so muscle memory + old links keep working.
import { redirect } from "next/navigation";
export default function SaCrewRedirect() {
  redirect("/team");
}
```

```tsx
// src/app/sa/crew/badges/page.tsx — spec 313 U1: moved with its parent to /team/badges.
import { redirect } from "next/navigation";
export default function SaCrewBadgesRedirect() {
  redirect("/team/badges");
}
```

- [ ] **Step 6: Retarget the SaTools ทีมงาน tile** (`sa-tools.tsx:83`): `href="/sa/crew"` → `href="/team"`; update `tests/unit/sa-tools.test.tsx:45` expectation to `"/team"`. (Tile is REMOVED in U3; this keeps rule 4 unbroken between U1 and U3.)

- [ ] **Step 7: Re-bucket the guard** — `tests/unit/nav-back-affordance.test.ts`:
  - STATIC_DETAIL: remove `"sa/crew"` + `"sa/crew/badges"` entries; add `"team/badges"` (comment: back chip → /team).
  - NON_DETAIL_ROUTES: add `"team"` (comment: spec 313 — the people hub).
  - EXCLUDED_ROUTES: add `"sa/crew/page.tsx"` + `"sa/crew/badges/page.tsx"` (thin redirects, like store/stock-count precedent).
  - HUB_STRIP_ROUTES: add `"team"`.

- [ ] **Step 8: Full suite + browser-verify** (dev-preview as site_admin: /team shows CTA → cockpit opens; /sa/crew redirects; as super_admin: approver card shows) → **Step 9: site-map rows** → **Step 10: fresh-eyes → ship-pr.sh** (code-only, auto-merge).

---

### Unit 2: Label split — รายชื่อช่าง + แรงงาน + ทีมงาน SSOT

**Files:**

- Modify: `src/lib/i18n/labels.ts` (3 new consts near `WORKER_TEAM_LABEL`, lines ~21–25)
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx:621` (labor tab label)
- Modify: `src/app/sa/page.tsx:317` (ActionChip label)
- Modify: `src/app/workers/page.tsx:23,74` (metadata + h1)
- Test: `tests/unit/labels-nav-terms.test.ts` (new)

**Interfaces:**

- Produces: `TEAM_HUB_LABEL = "ทีมงาน"`, `WORKER_ROSTER_LABEL = "รายชื่อช่าง"`, `LABOR_TAB_LABEL = "แรงงาน"` — U3 tab/strip arrays consume all three.

- [ ] **Step 1: Failing test:**

```ts
import { describe, expect, it } from "vitest";
import { TEAM_HUB_LABEL, WORKER_ROSTER_LABEL, LABOR_TAB_LABEL } from "@/lib/i18n/labels";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("spec 313 D4 — one term per concept", () => {
  it("pins the three nav terms", () => {
    expect(TEAM_HUB_LABEL).toBe("ทีมงาน");
    expect(WORKER_ROSTER_LABEL).toBe("รายชื่อช่าง");
    expect(LABOR_TAB_LABEL).toBe("แรงงาน");
  });
  it("the WP labor tab + SA chip no longer use the literal ทีมงาน", () => {
    const wp = read("src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx");
    expect(wp).toContain("LABOR_TAB_LABEL");
    const sa = read("src/app/sa/page.tsx");
    expect(sa).toContain("LABOR_TAB_LABEL");
  });
  it("/workers is titled รายชื่อช่าง, not ทีมงาน", () => {
    const w = read("src/app/workers/page.tsx");
    expect(w).toContain("WORKER_ROSTER_LABEL");
    expect(w).not.toContain('title: "ทีมงาน"');
  });
});
```

- [ ] **Step 2: RED** (`pnpm test tests/unit/labels-nav-terms.test.ts` — imports fail). **Step 3: implement:**

`labels.ts` (append after line 25, `WORKER_TEAM_LABEL`):

```ts
// Spec 313 D4 — the nav-term split: ทีมงาน names ONLY the /team people hub;
// the company roster surface is รายชื่อช่าง; the WP daily labor log is แรงงาน.
export const TEAM_HUB_LABEL = "ทีมงาน";
export const WORKER_ROSTER_LABEL = "รายชื่อช่าง";
export const LABOR_TAB_LABEL = "แรงงาน";
```

WP detail page line 621: `label: "ทีมงาน",` → `label: LABOR_TAB_LABEL,` (+ import). `sa/page.tsx:317`: `label="ทีมงาน"` → `label={LABOR_TAB_LABEL}` (+ import). `workers/page.tsx`: `export const metadata = { title: WORKER_ROSTER_LABEL };` and h1 → `รายชื่อช่างและค่าแรง` (+ import).

- [ ] **Step 4: GREEN + full suite** (expect `wp-detail` tab tests referencing ทีมงาน to red → update those assertions to แรงงาน deliberately). **Step 5: browser-verify WP detail tab strip.** **Step 6: site-map term note; fresh-eyes; ship** (code-only).

---

### Unit 3: The map flip — tabs + strips + folds + รายงาน in-page link

> ## ⚠️ AMENDED 2026-07-20 — U3 WAS RE-SCOPED. Read this before the steps below.
>
> **The unit as originally written (2026-07-13) was overtaken by spec 323 U3b and
> would have REVERTED it.** Gate-checked against HEAD before building; the
> operator confirmed the re-scope. What actually shipped as U3:
>
> | Original step                                                              | Reality at HEAD                                                                      | Outcome                      |
> | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
> | `SA_TABS` += ทีมงาน `/team`                                                | already shipped (`bottom-tab-bar.tsx`, credited "spec 313 D2 / nav-coherence audit") | no-op                        |
> | SA hub strip += ทีมงาน `/team`                                             | already shipped (`SA_HUB_NAV`)                                                       | no-op                        |
> | `PM_TABS` += ทีมงาน, − `REGISTRATIONS_TAB`                                 | not done                                                                             | ✅ **shipped**               |
> | PM strip ทีมงาน→`/team`, roster→`รายชื่อช่าง`                              | not done                                                                             | ✅ **shipped**               |
> | `sa-tools` remove ทีมงาน tile                                              | still present                                                                        | ✅ **shipped**               |
> | `PROCUREMENT_TABS` = flat 6 (จัดซื้อ·โครงการ·ทีมงาน·ผู้ขาย·ค่าแรง·ตั้งค่า) | **superseded** by `PROCUREMENT_STR_SPINE` (หน้าหลัก·ขอบเขต·เวลา·ทรัพยากร·ตั้งค่า)    | ❌ **DROPPED**               |
> | `PROCUREMENT_MANAGER_TABS` = flat 6                                        | same spine; its คำขอสมัคร tab already dropped by 323 U3b                             | ❌ **DROPPED**               |
> | "รายงาน tab demoted to an in-page link on `/requests`"                     | procurement has no รายงาน tab at all any more                                        | ❌ **DROPPED, premise gone** |
>
> **Why the procurement half is dead:** spec 323 U3b replaced procurement's flat
> tab set with the STR spine (`/procurement` hub + three section sub-routes). The
> code says so in `bottom-tab-bar.tsx`: _"supersedes spec 70/101/102/262/309's
> flat set"_. This plan predates that decision. **Do not re-apply the
> `PROCUREMENT_*` pins below** — they are kept only as a record of what was
> originally intended.
>
> **Also note, on step 1's test instructions:** deleting the "รายงาน-lighting
> cases" and adding a `/requests/orders` lighting case does not apply — those
> tests do not exist in that form. The `/registrations`-lights-no-tab assertion
> WAS added. The `/team/badges`-lights-ทีมงาน case was added for the **PM** tier
> rather than the SA tier as written; behaviourally identical (SA_TABS' ทีมงาน
> href lights by the same longest-prefix rule), but not literally as specified.
>
> **U3 also shipped two things the plan did not ask for**, both consequences of
> the fold rather than scope creep: `/registrations` became multi-parent
> (`safeBackHref` + `?from` from the `/team` card + the nav-back-affordance
> guard entry) because the fold made `/team` its phone door while the page
> hardcoded `backHref="/dashboard"`; and `nav-law-strip-superset.test.ts` now
> derives rule 2 from `tabsForRole` × `hubNavForRole`, which previously had no
> mechanical guard at all.
>
> ⭐ **Process lesson:** a nav plan is a snapshot of a map that other lanes keep
> editing. Gate-check every pin against HEAD before building — the plan is not
> the SSOT, the code is. This is what unit gate 2 exists to catch.

**Files:**

- Modify: `src/components/features/chrome/bottom-tab-bar.tsx` (all changed sets; remove `REGISTRATIONS_TAB` from sets it leaves)
- Modify: `src/components/features/chrome/hub-nav.tsx` (mirror)
- Modify: `src/app/requests/page.tsx` (NEW รายงาน link in buyer view)
- Modify: `src/components/features/sa/sa-tools.tsx` (remove ทีมงาน tile) + `tests/unit/sa-tools.test.tsx`
- Test: `tests/unit/bottom-tab-bar.test.tsx`, `tests/unit/hub-nav.test.tsx`, `tests/unit/requests-primary-tab-nav.test.ts`

**Interfaces:**

- Consumes: `TEAM_HUB_LABEL`, `WORKER_ROSTER_LABEL` (U2); route `/team` (U1); `Users` + `HardHat` lucide icons.
- Produces: the target per-role sets below — U7 re-audits site-map against exactly these.

- [ ] **Step 1: Failing test — re-pin the canonical sets** in `bottom-tab-bar.test.tsx` (replace the current `toEqual` arrays wholesale):

```tsx
expect(SA_TABS.map((t) => [t.label, t.href])).toEqual([
  ["หน้าหลัก", "/sa"],
  ["โครงการ", "/projects"],
  // Spec 313: the people hub — เช็คชื่อ, crew, badges live here now.
  ["ทีมงาน", "/team"],
  ["จัดซื้อ", "/requests"],
  ["ตั้งค่า", "/settings"],
]);
expect(PM_TABS.map((t) => [t.label, t.href])).toEqual([
  ["โครงการ", "/projects"],
  // Spec 313: คำขอสมัคร tab folded into /team (queue section + count).
  ["ทีมงาน", "/team"],
  ["จัดซื้อ", "/requests"],
  ["ภาพรวม", "/dashboard"],
  ["ตั้งค่า", "/settings"],
]);
expect(PROCUREMENT_TABS.map((t) => [t.label, t.href])).toEqual([
  ["จัดซื้อ", "/requests"],
  ["โครงการ", "/projects"],
  // Spec 313: รายงาน tab demoted to an in-page link on /requests.
  ["ทีมงาน", "/team"],
  ["ผู้ขาย", "/contacts/vendors"],
  ["ค่าแรง", "/payroll"],
  ["ตั้งค่า", "/settings"],
]);
expect(PROCUREMENT_MANAGER_TABS.map((t) => [t.label, t.href])).toEqual([
  ["จัดซื้อ", "/requests"],
  ["โครงการ", "/projects"],
  ["ทีมงาน", "/team"],
  ["ผู้ขาย", "/contacts/vendors"],
  ["ค่าแรง", "/payroll"],
  ["ตั้งค่า", "/settings"],
]);
```

(COORDINATOR_TABS unchanged.) Update the lighting tests: DELETE the รายงาน-lighting cases; ADD `"/requests/orders"` lights `จัดซื้อ` for procurement; ADD `"/team/badges"` lights `ทีมงาน` for SA; the PM `"/registrations"` path now lights NO tab (assert the bar renders with zero `aria-current`).

Mirror pins in `hub-nav.test.tsx`:

```tsx
const PM_ITEMS = [
  { label: "โครงการและรายงาน", href: "/projects" },
  { label: "ทีมงาน", href: "/team" },
  { label: "จัดซื้อ", href: "/requests" },
  { label: "ภาพรวม", href: "/dashboard" },
  // Spec 313 D4: the roster keeps its URL under its own name (strip superset).
  { label: "รายชื่อช่าง", href: "/workers" },
  { label: "คำขอสมัคร", href: "/registrations" },
  { label: "ตั้งค่า", href: "/settings" },
];
```

SA strip: add `{ label: "ทีมงาน", href: "/team" }` after โครงการ. Procurement strips: `ทีมงาน` item retargets `/workers` → `/team`; the old roster item becomes `{ label: "รายชื่อช่าง", href: "/workers" }` (keeps position); `รายงาน` + `คำขอสมัคร` (mgr) stay on strips — rule 2 supersets, desktop loses nothing.

Add to `requests-primary-tab-nav.test.ts`: `expect(src).toContain('"/requests/reports"')` (the buyer view's in-page link).

- [ ] **Step 2: RED.** **Step 3: implement** — `bottom-tab-bar.tsx`: edit `SA_TABS` / `PM_TABS` / `PROCUREMENT_TABS` / `PROCUREMENT_MANAGER_TABS` to match the pins exactly; ทีมงาน tab = `{ label: TEAM_HUB_LABEL, href: "/team", icon: Users }` (import `Users`; import `TEAM_HUB_LABEL`); delete `REGISTRATIONS_TAB` const + `FileText`/`UserPlus` icons if now unused. `hub-nav.tsx`: mirror; use `TEAM_HUB_LABEL` + `WORKER_ROSTER_LABEL`.

  `requests/page.tsx` — insert as the FIRST child inside the buyer branch's `<div className="flex flex-col gap-6">` (line ~603):

```tsx
{
  /* Spec 313: รายงาน left the phone tab bar — this is its in-page home
                  (desktop keeps the hub-strip item). */
}
<Link
  href="/requests/reports"
  className="border-edge bg-card text-ink hover:bg-sunk flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold"
>
  รายงานจัดซื้อ
</Link>;
```

`sa-tools.tsx`: delete the ทีมงาน `<Tile>` block (lines 82–89) + drop `Users` import; `sa-tools.test.tsx`: replace the tile test with `expect(screen.queryByRole("link", { name: /ทีมงาน/ })).toBeNull()`.

- [ ] **Step 4: GREEN + full suite.** **Step 5: browser-verify all four roles' bars** (dev-preview + /settings/view-as). **Step 6: site-map tab tables; fresh-eyes; ship** (code-only — bottom-tab/hub-nav are NOT danger paths).

---

### Unit 4: SA โครงการ direct landing

**Files:**

- Create: `src/lib/nav/projects-landing.ts` (pure decision helper)
- Modify: `src/app/projects/page.tsx` (redirect + view param + chip pinning)
- Modify: `src/lib/projects/list-view.ts` (`projectListHref` gains `pinViewAll`)
- Modify: `src/components/features/projects/projects-filter-bar.tsx` (hidden `view=all` input)
- Modify: `src/app/projects/[projectId]/page.tsx:72` (back fallback)
- Test: `tests/unit/projects-landing.test.ts` (new), existing list-view tests

**Interfaces:**

- Consumes: `getSaCurrentProject` resolver; `projectHref`.
- Produces: `saProjectsLandingTarget({ role, view, currentProjectId }): string | null` — returns the redirect target or null (stay on hub).

- [ ] **Step 1: Failing test:**

```ts
import { describe, expect, it } from "vitest";
import { saProjectsLandingTarget } from "@/lib/nav/projects-landing";

describe("spec 313 U4 — SA โครงการ direct landing", () => {
  it("redirects a site_admin with a current project to its WP list", () => {
    expect(
      saProjectsLandingTarget({ role: "site_admin", view: undefined, currentProjectId: "p1" }),
    ).toBe("/projects/p1");
  });
  it("honors the explicit hub request (?view=all)", () => {
    expect(
      saProjectsLandingTarget({ role: "site_admin", view: "all", currentProjectId: "p1" }),
    ).toBeNull();
  });
  it("stays on the hub with zero projects", () => {
    expect(
      saProjectsLandingTarget({ role: "site_admin", view: undefined, currentProjectId: null }),
    ).toBeNull();
  });
  it("never redirects other roles", () => {
    for (const role of ["project_manager", "super_admin", "procurement", "project_coordinator"]) {
      expect(saProjectsLandingTarget({ role, view: undefined, currentProjectId: "p1" })).toBeNull();
    }
  });
});
```

- [ ] **Step 2: RED.** **Step 3: implement:**

```ts
// src/lib/nav/projects-landing.ts — spec 313 U4 (D3): the SA's โครงการ tab keeps its
// static /projects href; the hub itself sends a site_admin straight to the current
// project's WP list. ?view=all is the explicit hub escape — every SA-facing link
// back INTO the hub must carry it or the redirect re-fires (loop-proofing, spec §6).
import { projectHref } from "@/lib/nav/project-paths";

export function saProjectsLandingTarget(args: {
  role: string;
  view: string | undefined;
  currentProjectId: string | null;
}): string | null {
  if (args.role !== "site_admin") return null;
  if (args.view === "all") return null;
  if (!args.currentProjectId) return null;
  return projectHref(args.currentProjectId);
}
```

`projects/page.tsx` — after `const isCoordinator = …` (line 71):

```tsx
// Spec 313 U4: SA direct landing. Resolver runs only for site_admin (one extra
// read on a role that owns exactly this shortcut).
const view = pick(sp.view);
if (ctx.role === "site_admin") {
  const { current } = await getSaCurrentProject(supabase, ctx.id);
  const target = saProjectsLandingTarget({
    role: ctx.role,
    view,
    currentProjectId: current.projectId,
  });
  if (target) redirect(target);
}
```

(+ `import { redirect } from "next/navigation";`, `+ getSaCurrentProject`, `+ saProjectsLandingTarget`; `searchParams` type gains `view?: string | string[]`.)

`projectListHref` (list-view.ts): add 4th arg `opts?: { pinViewAll?: boolean }` → `if (opts?.pinViewAll) params.set("view", "all");` and thread a `pinViewAll` flag through `buildProjectStatusChips` / `buildProjectClientChips` inputs; the page passes `pinViewAll: ctx.role === "site_admin"`; `searchClearHref` likewise. `ProjectsFilterBar`: new optional `pinViewAll` prop → `{pinViewAll ? <input type="hidden" name="view" value="all" /> : null}` in the form.

`projects/[projectId]/page.tsx:72`:

```tsx
// Spec 313 U4: the SA hub carries the redirect; back must request the hub
// explicitly or it loops straight back to this page.
const backHref = safeBackHref(from, ctx.role === "site_admin" ? "/projects?view=all" : "/projects");
```

⚠ `ctx` must resolve before this line — move the `requireRole` call above the backHref computation if it isn't already (gate-check at build).

- [ ] **Step 4: GREEN + list-view tests updated.** **Step 5: browser-verify as SA**: โครงการ tab → lands on cockpit; back chip → full list; filter taps stay on list; search stays; zero-project SA (sandbox persona) → hub. As PM: no redirect, URLs clean. **Step 6: site-map row + Reached notes; fresh-eyes; ship** (code-only).

---

### Unit 5: Hub promotion — /accounting · /legal · /expenses

**Files:**

- Modify: `src/app/accounting/page.tsx`, `src/app/legal/page.tsx`, `src/app/expenses/page.tsx` (DetailHeader → AppHeader + HubNav)
- Modify: `src/components/features/chrome/bottom-tab-bar.tsx` (`SETTINGS_TAB.match` += `"/expenses"`)
- Test: `tests/unit/nav-back-affordance.test.ts`, `tests/unit/bottom-tab-bar.test.tsx`

- [ ] **Step 1: Failing test** — nav-back-affordance: move `"accounting"`, `"legal"`, `"expenses"` OUT of STATIC_DETAIL into NON_DETAIL_ROUTES; add `"accounting"`, `"legal"`, `"expenses"` to HUB_STRIP_ROUTES. Run → fails (pages still render DetailHeader / lack HubNav).
- [ ] **Step 2: implement per page** — pattern (legal shown; accounting + expenses identical shape):

```tsx
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker={LEGAL_LABEL} fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />
      <HubNav items={hubNavForRole(ctx.role) ?? []} currentHref="/legal" />
```

Remove the `DetailHeader backHref="/settings"` blocks (legal:81, expenses:45, accounting's render below line 70 — locate at build). Keep every body section untouched. Sub-drills (`/accounting/*`, `/legal/*`) keep their back → parent chips — untouched.

- [ ] **Step 3:** `SETTINGS_TAB.match` gains `"/expenses"` (comment: spec 313 U5 — non-expense-home roles reach it from ตั้งค่า; site_owner/auditor get their own tab in U6, which wins the equal-length tie by array order). Lighting test: PM on `/expenses` lights ตั้งค่า.
- [ ] **Step 4: GREEN + browser-verify** accounting + legal + expenses as their roles (view-as): strip renders, no back chip, body intact. **Step 5: site-map; fresh-eyes; ship** (code-only).

---

### Unit 6: site_owner + auditor land on /expenses — ⚠ DANGER-PATH (operator-HELD)

**Files:**

- Modify: `src/lib/auth/role-home.ts:503` region (two roleHome arms)
- Modify: `src/components/features/chrome/bottom-tab-bar.tsx` + `hub-nav.tsx` (EXPENSE sets + selectors)
- Test: `tests/unit/role-home.test.ts` (BOTH blocks), `tests/unit/role-sets.test.ts` (the site_owner/auditor "/coming-soon" cross-check), `tests/unit/bottom-tab-bar.test.tsx`, `tests/unit/hub-nav.test.tsx`

- [ ] **Step 1: Failing test** — role-home.test.ts EXPECTED table: `site_owner: "/expenses"`, `auditor: "/expenses"`; REMOVE both lines from the still-unserved test; role-sets.test.ts: update the site_owner/auditor landing assertion to `/expenses`.
- [ ] **Step 2: implement** — `role-home.ts`, before the final `return "/coming-soon";`:

```ts
// Spec 313 U6: site_owner + auditor hold OFFICE_EXPENSE_ROLES rights (spec 310)
// but had no landing at all — the wall blocked a granted capability. They land
// on the expense surface; everything else still falls through to /coming-soon.
if (role === "site_owner" || role === "auditor") return "/expenses";
```

`bottom-tab-bar.tsx`:

```tsx
// Spec 313 U6: the expense-holder roles' lean two-tab set (accounting/legal pattern).
export const EXPENSE_TABS: ReadonlyArray<TabItem> = [
  { label: "ค่าใช้จ่าย", href: "/expenses", icon: ReceiptText },
  SETTINGS_TAB,
];
```

`tabsForRole`: `if (role === "site_owner" || role === "auditor") return EXPENSE_TABS;`. Mirror `EXPENSE_HUB_NAV` + `hubNavForRole` in hub-nav.tsx. Import `ReceiptText` from lucide-react.

- [ ] **Step 3: GREEN + full suite.** **Step 4: browser-verify via /settings/view-as** (site_owner: lands on /expenses, can open the FAB form; ค่าใช้จ่าย tab lit — first-wins tie). **Step 5: site-map roleHome table; fresh-eyes; ship-pr.sh → PR is guard-HELD by design (src/lib/auth/**): 🔔 operator merge.\*\*

---

### Unit 7: Guard pinning + site-map re-audit + help-card honesty

**Files:**

- Modify: `tests/unit/hub-nav.test.tsx` (LEGAL_HUB_NAV + COORDINATOR_HUB_NAV + EXPENSE_HUB_NAV `toEqual` pins + legal/site_owner/auditor selector cases)
- Modify: `tests/unit/bottom-tab-bar.test.tsx` (LEGAL_TABS + EXPENSE_TABS pins)
- Modify: `src/lib/sa/help-content.ts:31–41` (muster card)
- Modify: `docs/site-map.md` (FULL re-audit: every route row, Back→ column, roleHome table, tab sections, audit stamp) + `docs/ui-conventions.md` §12 (add /team row to the surface table; clear the stale /coming-soon self-note)

- [ ] **Step 1:** Add the missing set pins (write them from the live constants at HEAD — they are guards, so `toEqual` full arrays). **Step 2:** Help card:

```ts
  {
    id: "muster",
    title: "เช็คชื่อทีมงาน",
    whenToUse: "ต้นวัน เพื่อบันทึกว่าวันนี้ใครมาทำงาน",
    steps: [
      "ไปที่แท็บ ทีมงาน แล้วกดปุ่ม เช็คชื่อ",
      "สแกน QR บัตรช่าง หรือกดชื่อ เพื่อบันทึกเข้า-ออก",
      "แถบ “ทีมงานวันนี้” ที่หน้าหลัก ยังใช้ทำเครื่องหมาย มา/ไม่มา สำหรับค่าแรงเหมือนเดิม",
    ],
    tip: "เช็คชื่อทุกเช้า ช่วยให้คิดค่าแรงและวางแผนงานได้ถูกต้อง",
  },
```

(Both flows documented honestly — the scan cockpit AND the plan strip; the strip stays the wage path until 306 U5.)

- [ ] **Step 3:** site-map full rewrite of affected rows + stamp; §12 table row `people hub | /team | team page sections (code SSOT)`. **Step 4: full suite; fresh-eyes; ship** (docs+tests, auto-merge).

---

## Post-plan notes

- **P3 (attendance cutover)** is deliberately absent — blocked on 306 U5 (money, operator-held). Nothing here touches `log_labor_day`, MusterStrip, or wages.
- **Rollback:** every unit is independently revertable; `/sa/crew*` redirects guarantee no dead bookmarks.
- **LANES:** single lane `313nav`, serialized — every unit touches nav SSOTs.
