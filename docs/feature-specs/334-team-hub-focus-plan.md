# Spec 334 implementation plan — /team hub focus

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> One fresh subagent per task; the orchestrator reviews between tasks. Steps use
> checkbox syntax. Every file path below was gate-checked against worktree HEAD
> `d4510f8d` on 2026-07-21 — if your HEAD differs, re-verify before editing.

**Goal:** `/team` becomes วันนี้-first for the SA — attendance hero + icon tiles —
with the merged roster on its own `/team/roster` route. Spec:
`docs/feature-specs/334-team-hub-focus.md` (read it first; it is the contract).

**Architecture:** read-only recompose. One new pure shaper + narrow loader
(`day-summary.ts`), one new server component (`MusterTodayCard`), one new route
(`/team/roster`), a tile grid replacing the hub's list blocks. Zero schema, zero
new write paths, zero `src/lib/auth/**` edits (role sets are imported, never
modified).

**Tech stack:** Next.js 16 App Router server components · Supabase server client
(`@/lib/db/server`) · Vitest + RTL (jsdom) · Tailwind tokens from `globals.css`
(raw palette classes banned — `bg-card`, `text-ink`, `bg-danger`, `bg-sunk`, …).

## Global constraints

- TDD, RED first — the failing test is written and SEEN failing before any
  production code. Each task states its RED command.
- **Mutation-check every text/absence assertion** (doctrine): break the
  production code by hand, watch the test red, restore. ≥2-occurrence rule for
  const-usage pins; bare-literal (unquoted) pins for absences.
- Thai strings used on 2+ surfaces live in `src/lib/i18n/labels.ts`. New 1-surface
  strings stay local to their component.
- Tap targets ≥44px → `min-h-11` floor (`min-h-9` is build-banned).
- Server Components by default; `'use client'` needs a PR-description justification
  (none of these tasks should need a new one).
- Subagents: work ONLY inside `D:\claude\projects\prc-ops\prc-ops-334team`; `cd`
  in EVERY Bash command; prefix PATH with `/c/Program Files/nodejs`; **no git
  commands** (the orchestrator commits); run only your scoped test files, not the
  full suite; Thai text via the Edit/Write tools only (PowerShell corrupts it).
- Scope discipline: implement exactly the task. Out-of-scope observations go in
  your report, not the code.

## File structure (whole spec)

| file                                                                       | task | responsibility                                                               |
| -------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `src/lib/i18n/labels.ts`                                                   | 1    | +`MUSTER_DAY_CLOSED_LABEL` ("ปิดวันแล้ว") + hero strings used on 2+ surfaces |
| `src/components/features/muster/muster-cockpit.tsx`                        | 1    | consume `MUSTER_DAY_CLOSED_LABEL` (line ~138 literal today)                  |
| `src/lib/muster/day-summary.ts`                                            | 1    | `summariseMusterDay` (pure) + `loadMusterDaySummary` (narrow reads)          |
| `tests/unit/muster-day-summary.test.ts`                                    | 1    | state machine + distinct-worker + present>expected + zero-expected           |
| `src/components/features/sa/muster-today-card.tsx`                         | 2    | the วันนี้ hero (server component, pure props)                               |
| `tests/unit/muster-today-card.test.tsx`                                    | 2    | per-state render + negative cases                                            |
| `src/components/features/sa/site-team-board.tsx`                           | 3    | member rows gain `costPending` chip (existing `bankPending` pattern)         |
| `src/lib/sa/site-team-board.ts`                                            | 3    | `SiteTeamMember` gains `costPending?: boolean`                               |
| `src/app/team/roster/page.tsx`                                             | 3    | new route: DetailHeader + merged board; crew-pair gate                       |
| `tests/unit/team-roster-page.test.tsx`                                     | 3    | empty state + chip mapping + gate                                            |
| `src/components/features/sa/crew-progress-roster.tsx` + its test           | 4    | DELETED (รอตรวจ → tile bubble; chips → roster)                               |
| `src/components/features/sa/team-tiles.tsx`                                | 4    | tile grid + count bubbles (ownership colours, zero → no bubble)              |
| `src/app/team/page.tsx`                                                    | 4    | recompose: hero + tiles, list blocks out                                     |
| `tests/unit/team-tiles.test.tsx` + `tests/unit/team-hub-recompose.test.ts` | 4    | bubble suppression · per-role tiles vs SSOTs · absence pins                  |
| `tests/unit/nav-back-affordance.test.ts`                                   | 3    | `team/roster` classified as detail route                                     |
| `docs/site-map.md`                                                         | 5    | `/team` row rewritten + `/team/roster` row added                             |
| `src/lib/sa/help-content.ts`                                               | 5    | `manage` card re-gate-checked against the NEW hub                            |
| `tests/unit/sa-help-honesty.test.ts`                                       | 5    | pins updated alongside                                                       |
| `docs/progress-tracker.md`                                                 | 5    | spec 334 unit statuses                                                       |

Predictable guard trips (from the guard-trip map, pre-empted): new `page.tsx` →
nav-back-affordance classification (task 3 does it); components stay in the
existing `sa/` + `muster/` feature folders so the folder-allowlist guard never
fires; no new enum, no new RLS, no settings section.

---

### Task 1 — labels + `day-summary` (pure lib)

**Files:**

- Modify: `src/lib/i18n/labels.ts` (append near `MUSTER_LABEL`, line ~130)
- Modify: `src/components/features/muster/muster-cockpit.tsx` (~line 138)
- Create: `src/lib/muster/day-summary.ts`
- Create: `tests/unit/muster-day-summary.test.ts`

**Interfaces — produces (tasks 2 and 4 rely on these exact names):**

```ts
// labels.ts — ONLY the 2-surface string. มาทำงาน / the CTA strings render in ONE
// component (the card), so they stay local to it per the SSOT rule.
export const MUSTER_DAY_CLOSED_LABEL = "ปิดวันแล้ว";

// day-summary.ts
export interface MusterDaySummary {
  state: "not_started" | "open" | "closed";
  present: number;
  expected: number;
  closedAt: string | null;
}
export function summariseMusterDay(raw: {
  teamCount: number;
  attendanceWorkerIds: string[]; // worker_id per attendance row, dupes possible
  expected: number;
  closure: { closed_at: string } | null;
}): MusterDaySummary;
export async function loadMusterDaySummary(
  supabase: ServerClient, // SupabaseClient<Database>, same alias as load-muster.ts
  projectId: string,
  date: string,
): Promise<MusterDaySummary>;
```

- [ ] **1.1 RED — write `tests/unit/muster-day-summary.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { summariseMusterDay } from "@/lib/muster/day-summary";

const closure = { closed_at: "2026-07-21T10:00:00Z" };

describe("summariseMusterDay", () => {
  it("no teams today → not_started, present 0", () => {
    const s = summariseMusterDay({
      teamCount: 0,
      attendanceWorkerIds: [],
      expected: 25,
      closure: null,
    });
    expect(s).toEqual({ state: "not_started", present: 0, expected: 25, closedAt: null });
  });
  it("teams open, no closure → open with distinct present", () => {
    const s = summariseMusterDay({
      teamCount: 2,
      attendanceWorkerIds: ["a", "b", "a"],
      expected: 25,
      closure: null,
    });
    expect(s.state).toBe("open");
    expect(s.present).toBe(2); // moved worker counted once
  });
  it("closure row → closed + closedAt, even with teams", () => {
    const s = summariseMusterDay({
      teamCount: 1,
      attendanceWorkerIds: ["a"],
      expected: 25,
      closure,
    });
    expect(s.state).toBe("closed");
    expect(s.closedAt).toBe(closure.closed_at);
  });
  it("closure wins over zero teams (closed empty day)", () => {
    expect(
      summariseMusterDay({ teamCount: 0, attendanceWorkerIds: [], expected: 25, closure }).state,
    ).toBe("closed");
  });
  it("present may exceed expected — spec: render truth, never clamp", () => {
    const s = summariseMusterDay({
      teamCount: 1,
      attendanceWorkerIds: ["a", "b", "c"],
      expected: 2,
      closure: null,
    });
    expect(s.present).toBe(3);
    expect(s.expected).toBe(2);
  });
  it("zero expected is representable (empty project)", () => {
    expect(
      summariseMusterDay({ teamCount: 0, attendanceWorkerIds: [], expected: 0, closure: null })
        .expected,
    ).toBe(0);
  });
});
```

- [ ] **1.2 Run — expect FAIL** (module not found):
      `cd D:\claude\projects\prc-ops\prc-ops-334team && pnpm test tests/unit/muster-day-summary.test.ts`
- [ ] **1.3 Implement `src/lib/muster/day-summary.ts`** — spec Model section. Shape:

```ts
// Spec 334 U1 — the /team hero's narrow read. Deliberately NOT loadMusterBoard:
// the hub needs three numbers, not the cockpit's full editing surface.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

type ServerClient = SupabaseClient<Database>;

export interface MusterDaySummary {
  /* as Interfaces block */
}

export function summariseMusterDay(raw: { /* as Interfaces block */ }): MusterDaySummary {
  const present = new Set(raw.attendanceWorkerIds).size;
  const base = { present, expected: raw.expected };
  if (raw.closure) return { ...base, state: "closed", closedAt: raw.closure.closed_at };
  if (raw.teamCount === 0) return { ...base, state: "not_started", closedAt: null };
  return { ...base, state: "open", closedAt: null };
}

export async function loadMusterDaySummary(
  supabase: ServerClient,
  projectId: string,
  date: string,
) {
  // teams today (ids only) → attendance worker_ids over those ids → closure → active-worker count
  // Every read is null-tolerant: a failed read degrades to [] / null, never throws —
  // spec U1 negative case "card falls back to not_started, never blanks the hub".
}
```

Loader reads, in order: `muster_teams` `select id` eq project+date → if ids,
`muster_attendance` `select worker_id` in team_ids (in_at is set by scan; rows ARE
presence) → `muster_day_closures` `select closed_at` eq project+date maybeSingle →
`workers` `select id`(count via `{ count: "exact", head: true }`) eq project_id +
active. Compose through `summariseMusterDay`.

- [ ] **1.4 Run 1.1 test — expect PASS.**
- [ ] **1.5 Labels + cockpit swap.** Append the two exports beside `MUSTER_LABEL`
      (~line 130). In `muster-cockpit.tsx` replace the literal `ปิดวันแล้ว` (line ~138,
      inside `board.closure ? (...)`) with `{MUSTER_DAY_CLOSED_LABEL}` (import it from
      the existing `@/lib/i18n/labels` import). Add to the existing cockpit test file
      (`grep -l "muster-cockpit" tests/unit/`) an assertion that the closed banner
      renders `MUSTER_DAY_CLOSED_LABEL` — import the const, do NOT hardcode the string.
- [ ] **1.6 Mutation-check:** delete the `{MUSTER_DAY_CLOSED_LABEL}` usage from the
      cockpit temporarily → its test reds; restore. Report the red output.
- [ ] **1.7 Scoped green:** `pnpm test tests/unit/muster-day-summary.test.ts tests/unit/muster-cockpit*.test.tsx` (whatever the cockpit test file is called) + `pnpm typecheck`.

### Task 2 — `MusterTodayCard`

**Files:**

- Create: `src/components/features/sa/muster-today-card.tsx`
- Create: `tests/unit/muster-today-card.test.tsx`

**Interfaces — consumes:** `MusterDaySummary`, `MUSTER_DAY_CLOSED_LABEL` (task 1);
`musterHref(projectId)` from `@/lib/nav/project-paths`; the CTA + มาทำงาน strings
are new and LOCAL to this component (single surface).
**Produces:** `export function MusterTodayCard({ summary, projectId, projectName, dateLabel }: { summary: MusterDaySummary; projectId: string; projectName: string; dateLabel: string })` — server component, pure props, no data fetching (the page fetches).

Spec state table is the contract:

| state                     | headline                                       | CTA (all → `musterHref(projectId)`)                |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `not_started`             | `0 / 25 มาทำงาน` + `ยังไม่มีใครเช็คชื่อวันนี้` | `เริ่มเช็คชื่อ` — primary (`bg-fill text-on-fill`) |
| `open`                    | `12 / 25 มาทำงาน`                              | `ไปหน้าเช็คชื่อ` — primary                         |
| `closed`                  | `ปิดวันแล้ว · มาทำงาน 18 คน`                   | `ดูรายละเอียด` — quiet (`border-edge bg-card`)     |
| any, `expected === 0`     | `ยังไม่มีช่างในโครงการนี้` replaces the count  | CTA still renders                                  |
| `closed`, `present === 0` | `ปิดวันแล้ว · ไม่มีคนมาทำงาน`                  | quiet CTA                                          |

Strings `เริ่มเช็คชื่อ` / `ไปหน้าเช็คชื่อ` / `ดูรายละเอียด` / `ยังไม่มีใครเช็คชื่อวันนี้` /
`ยังไม่มีช่างในโครงการนี้` / `ไม่มีคนมาทำงาน` are single-surface → local consts in the
component file, NOT labels.ts. Card visual: bordered card, project name + dateLabel
line, big count, full-width CTA `min-h-11` — follow the existing token idiom in
`team/page.tsx` (e.g. the current เช็คชื่อ Link classes).

- [ ] **2.1 RED — `tests/unit/muster-today-card.test.tsx`:** RTL render per row of
      the table above (5 cases) + assert the CTA `href` equals `musterHref("p1")` in all
      states + `not_started` CTA text is `เริ่มเช็คชื่อ` while `open`'s is `ไปหน้าเช็คชื่อ`.
      Import `MUSTER_DAY_CLOSED_LABEL` for the closed assertions — never retype the string.
- [ ] **2.2 Run — FAIL** (module not found): `pnpm test tests/unit/muster-today-card.test.tsx`
- [ ] **2.3 Implement.** Branch on `summary.state` + the two zero guards. No client
      JS, no fetch.
- [ ] **2.4 Run — PASS** + `pnpm typecheck`.
- [ ] **2.5 Mutation-check:** swap the `open` CTA string to `เริ่มเช็คชื่อ` → test
      reds; restore. Report output.

### Task 3 — `/team/roster` + chips

**Files:**

- Modify: `src/lib/sa/site-team-board.ts` — `SiteTeamMember` gains `costPending?: boolean`; `buildSiteTeamBoard` input gains `costPendingByWorker: Set<string>` (or a per-member flag threaded like the existing exception logic — read the file, match its idiom)
- Modify: `src/components/features/sa/site-team-board.tsx` — `MemberRow` renders a `รอ PM ยืนยัน` chip when `member.costPending` (copy the existing `bankPending` chip classes in `crew-progress-roster.tsx`; also render `bankPending` here — port `BANK_PENDING_CHIP_LABEL` usage)
- Create: `src/app/team/roster/page.tsx`
- Create: `tests/unit/team-roster-page.test.tsx`
- Modify: `tests/unit/nav-back-affordance.test.ts` — add `"team/roster"` to the
  detail bucket (near the existing `"team/badges"` entry ~line 179, with a spec-334
  comment)

**Interfaces — consumes:** `buildCrewTeams` + `buildSiteTeamBoard` (existing),
`WORKER_ROSTER_LABEL`, `DetailHeader` (`backHref` `backLabel` `children`),
`withBackFrom`. **Produces:** the route only; task 4 links to `/team/roster`.

Page = `requireRole(["site_admin", "super_admin"])` (crew pair — spec U2, NOT
TEAM_PAGE_ROLES; a literal like `/sa`'s own gate, cite the site-map row precedent).
Data assembly: lift the isCrew crew-block queries from `team/page.tsx` lines 75–263
(wpRows → projectIds → workers/crews/members/plans/categories → `buildCrewTeams` →
`buildSiteTeamBoard`) — move, do not fork: the hub stops running these in task 4,
so duplication lives for exactly one task. `costPendingByWorker` = workers with
`cost_confirmed_at === null`. Skip the QR-card generation and registration reads —
they stay hub-side. Chrome: `DetailHeader backHref="/team" backLabel="ทีมงาน"`,
h1 `รายชื่อทีม`, NO BottomTabBar/HubNav (detail page). Title metadata `รายชื่อทีม`.

Empty state (spec U2): `ยังไม่มีช่างในระบบ — เพิ่มช่างจากหน้าทีมงาน` via the existing
`EmptyNotice`. No-crews case needs NO code: verify by reading `buildSiteTeamBoard`
that crewless workers land in `unassigned` (they do — assert it in the test).

- [ ] **3.1 RED — `tests/unit/team-roster-page.test.tsx`:** (a) `MemberRow`-level:
      a member with `costPending` + `bankPending` renders BOTH chips (import
      `BANK_PENDING_CHIP_LABEL`, assert the `รอ PM ยืนยัน` text); (b) board-level: all
      workers crewless → everything under `ยังไม่ได้จัดทีม` (import
      `UNASSIGNED_TEAM_LABEL`), no ทีมภายใน bucket rendered; (c) zero workers → the
      empty string above renders. Drive the COMPONENT with built board data (the page
      is async server — test the pieces, as the existing site-board tests do; find them
      with `grep -rl "SiteTeamBoard" tests/unit/`).
- [ ] **3.2 Run — FAIL** (`costPending` unknown prop / chip absent):
      `pnpm test tests/unit/team-roster-page.test.tsx`
- [ ] **3.3 Implement** lib flag → chip → page.
- [ ] **3.4 nav-back guard:** run
      `pnpm test tests/unit/nav-back-affordance.test.ts` FIRST — expect it RED on the
      unclassified new route (if it stays green, STOP: the guard never saw the route —
      find out why before adding the entry; doctrine "a green you expected red is a
      finding"). Then add `"team/roster"` to the detail bucket, expect green.
- [ ] **3.5 Scoped green:** the two test files + any existing site-team-board test +
      `pnpm typecheck`.
- [ ] **3.6 Mutation-check:** remove the `costPending` chip render → (a) reds;
      restore. Report.

### Task 4 — hub recompose

**Files:**

- Create: `src/components/features/sa/team-tiles.tsx`
- Delete: `src/components/features/sa/crew-progress-roster.tsx`,
  `tests/unit/crew-progress-roster.test.tsx`
- Modify: `src/app/team/page.tsx` (major rewrite of the body; keep the role gate,
  chrome, and QR/AddTechnicianSheet data assembly)
- Create: `tests/unit/team-tiles.test.tsx`, `tests/unit/team-hub-recompose.test.ts`

**Interfaces — consumes:** `MusterTodayCard` + `loadMusterDaySummary` (tasks 1–2),
`/team/roster` (task 3), `AddTechnicianSheet` (existing — needs a new optional
`initialMode?: "choose" | "has_phone"` prop for the QR สมัคร tile: same sheet,
pre-branched; its `Mode` union already has `"has_phone"`), `STAFF_APPROVAL_ROLES`,
`WORKER_ROSTER_ROLES`, `WORKER_ROSTER_LABEL`, `withBackFrom`, lucide icons
(`UserPlus`, `Users`, `HardHat`, `Wallet`, `IdCard`, `QrCode`, `ScanLine`).

**Produces:** `export interface TeamTile { key: string; label: string; icon: LucideIcon; href?: string; bubble?: { n: number; tone: "danger" | "warning" | "neutral" } }` and `export function TeamTiles({ tiles }: { tiles: TeamTile[] })` + `export function teamTilesForRole(ctx: { role: UserRole; isCrew: boolean; counts: { pendingRegistrations: number; unassigned: number; activeWorkers: number } }): TeamTile[]` (pure — THE testable SSOT; tone rules and zero-suppression live here, not in JSX).

Hub body after: hero (isCrew && current project) → `TeamTiles` grid
(`grid grid-cols-3 gap-3`, tile = icon + label + absolute-positioned bubble;
bubble tones: danger `bg-danger text-on-fill` · warning `bg-attn-soft text-attn-ink border-attn-edge` · neutral `bg-sunk text-ink-secondary border-edge`;
tile base = SaTools idiom: `rounded-card border-edge bg-card shadow-card min-h-20`)
→ nothing else. Per-tile audience table is in the spec (per-tile audience block) —
implement `teamTilesForRole` exactly from it. เพิ่มช่าง + QR สมัคร tiles open the
sheet (they are buttons inside the client `AddTechnicianSheet` trigger area, or the
sheet gains a second trigger — read the sheet component first and keep ONE sheet
instance). ยังไม่จัดทีม bubble = **neutral** (spec review fix — D4 honesty). Data
kept on the page: QR cards, firm QR cards, pending registrations count,
active-worker + unassigned counts (workers minus crew_members distinct), muster
summary. The board/roster queries LEAVE (they moved to `/team/roster` in task 3) —
delete the now-unused imports (`CrewProgressRoster`, `SiteTeamBoard`,
`buildCrewTeams`, `buildSiteTeamBoard`, `listVisibleTechnicianRegistrations` stays
for the count).

- [ ] **4.1 RED — `tests/unit/team-tiles.test.tsx`:** over `teamTilesForRole`:
      (a) zero count → NO bubble object on that tile (assert `bubble` undefined, not
      `n: 0`); (b) `site_admin` + isCrew → tile keys exactly
      `["registrations","unassigned","roster","add","badges","register-qr"]`;
      (c) `super_admin` (approver + crew + roster role) additionally carries
      `["workers","payroll"]`; (d) `procurement` → ONLY `["workers","payroll"]`
      (plain procurement is NOT in `STAFF_APPROVAL_ROLES`); (e) `project_manager` →
      exactly the `WORKER_ROSTER_ROLES`-driven pair (PM_ROLES ⊂ WORKER_ROSTER_ROLES —
      today's hub already shows PM these two, no gain no loss) — derive every
      expectation from `STAFF_APPROVAL_ROLES.includes(role)` /
      `WORKER_ROSTER_ROLES.includes(role)`, NOT hardcoded role lists (guard-trip:
      enum growth); (f) ยังไม่จัดทีม tone is `"neutral"` even
      when n > 0; (g) คำขอสมัคร href: site_admin → `/sa/registrations`-based,
      approvers → `/registrations`-based (both `withBackFrom(..., "/team")`).
- [ ] **4.2 RED — `tests/unit/team-hub-recompose.test.ts`:** read
      `src/app/team/page.tsx` source (fs, like the existing source-pin tests — see
      `sa-help-honesty.test.ts` for the read idiom): (a) absence: bare
      `CrewProgressRoster` and `SiteTeamBoard` do NOT appear; (b) presence ≥2:
      `MusterTodayCard` and `TeamTiles` each appear ≥2× (import + JSX — the
      split-length idiom from doctrine); (c) `crew-progress-roster` file no longer
      exists on disk.
- [ ] **4.3 Run both — FAIL:** `pnpm test tests/unit/team-tiles.test.tsx tests/unit/team-hub-recompose.test.ts`
- [ ] **4.4 Implement:** `teamTilesForRole` + `TeamTiles` → rewrite the page body →
      delete the two files → `AddTechnicianSheet` `initialMode` prop (default
      `"choose"`, no behaviour change for existing call sites; update its existing test
      file only if it reds).
- [ ] **4.5 Run — PASS** + `pnpm test tests/unit/team-roster-page.test.tsx`
      (task 3's must stay green) + `pnpm typecheck && pnpm lint`.
- [ ] **4.6 Mutation-checks (all three, report each):** re-add a
      `<SiteTeamBoard`-bearing JSX comment → absence pin reds (bare-literal pin proves
      it); make `teamTilesForRole` return a `{ n: 0 }` bubble → suppression test reds;
      flip ยังไม่จัดทีม tone to `"warning"` → (f) reds. Restore all.

### Task 5 — pins, site-map, help honesty, tracker

**Files:**

- Modify: `docs/site-map.md` — rewrite the `/team` row (~line 153: gate unchanged,
  body = วันนี้ hero + tile grid, per-tile audiences; drop the CrewProgressRoster/
  ทีมหน้างาน wording) + add a `/team/roster` row (crew-pair gate, DetailHeader back
  → `/team`, merged board + chips) + touch the ทีมงาน narrative block (~lines
  51–79) if it names the retired blocks
- Modify: `src/lib/sa/help-content.ts` — the `manage` card steps (lines ~71–83)
  name รอตรวจ→รอยืนยัน→พร้อม and ทีมหน้างาน — BOTH retired from the hub. Rewrite
  against the REAL post-task-4 affordances (doctrine: open `team/page.tsx` +
  `team/roster/page.tsx` at HEAD and pin to actual labels: แตะ "รายชื่อทีม" →
  สถานะ chips รอ PM ยืนยัน on the roster). Check the `muster` card too — its
  cockpit steps are untouched by this spec, verify not broken.
- Modify: `tests/unit/sa-help-honesty.test.ts` — update pins alongside; every
  UI string the card quotes must exist in the component source it describes.
- Modify: `docs/progress-tracker.md` — spec 334 section, units 1–5 statuses +
  decisions + open questions (the spec's Open-questions block).

- [ ] **5.1 RED first where a pin exists:** run
      `pnpm test tests/unit/sa-help-honesty.test.ts` BEFORE editing — if task 4's
      recompose already redded it (it pins hub strings), that IS the red; if green,
      STOP and check what the guard actually pins before rewriting prose.
- [ ] **5.2 Rewrite help card + pins; run green.**
- [ ] **5.3 site-map rows + tracker.** No tests read site-map; correctness =
      gate-check against the shipped components (quote real labels only).
- [ ] **5.4 Full-suite green:** `pnpm lint && pnpm typecheck && pnpm test` (this
      task closes the spec — full suite REQUIRED here, background it and grep for
      failure NAMES per doctrine, never `tail` alone).

### Task 6 — orchestrator-only: verify + ship (NOT a subagent)

- [ ] Fresh-eyes review of the FULL diff (cavecrew-reviewer subagent, model opus);
      address every finding with rigor.
- [ ] Browser real-flow drive (dev-preview super_admin + view-as site_admin, memory
      `dev-preview-login`): hub hero `0 / 25` + tiles with real bubbles (3 on
      คำขอสมัคร) → roster opens grouped with chips → back chip returns to `/team` →
      badges/QR doors still work → zero console errors. State-flip check per spec
      Verification #3 (open a muster team in the cockpit → hero flips `open`; clean
      the test rows after).
- [ ] `scripts/ship-pr.sh` — ONE PR for the whole spec (code-only, no danger
      paths → auto-merges on green). PR body: spec link, unit list, the 3 review
      fixes, browser evidence.
- [ ] LANES move + memory close-out per doctrine §6.
