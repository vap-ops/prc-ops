# Spec 359 — Continuous QR sweep: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every task additionally passes the repo's own **unit
> gates** (CLAUDE.md) — lane claim, dependency gate-check, RED-first, real-flow verify, fresh-eyes
> review, `scripts/ship-pr.sh`.

**Goal:** Make a QR scan cheaper than a tap at the morning muster, so `muster_attendance.in_method`
stops being 1-in-36 manual.

**Architecture:** The add sheet stops closing on a successful decode. All new logic lives in a
**pure, client-safe reducer** (`src/lib/muster/sweep.ts`) that the sheet and cockpit drive — outcome
classification, the per-badge cooldown, and the running tally are decided there, off the untestable
camera loop. Outcomes are classified from **board state**, not by parsing RPC error strings, so a
sweep never depends on Thai message matching. The server write stays the existing `musterScan`
action; `router.refresh()` is deferred to sheet close so a sweep is not N round-trips of re-render.

**Tech Stack:** Next.js 16 App Router, React 19 (`useTransition`, `useSyncExternalStore`),
TypeScript strict, Vitest + React Testing Library (jsdom), Tailwind with the `globals.css` token
system.

## Global Constraints

- **No schema, no migration, no `supabase/` change.** Gate-checked: both muster SELECT policies are
  project-scoped with no date predicate, so the prior-day read needs no DEFINER RPC.
  `load-muster.ts:315-318` already records this ("verified live").
- **Thai UI copy only.** Every user-facing string is Thai. Terms reused 2+ places go through
  `src/lib/i18n/labels.ts` (UI-term-consistency SSOT).
- **Field-First design tokens only** — `bg-card`, `bg-sunk`, `text-ink`, `text-ink-secondary`,
  `text-ink-muted`, `text-meta`, `bg-attn-soft`, `text-attn-ink`, `bg-danger-soft`,
  `text-danger-ink`, `rounded-card`. **Raw Tailwind palette colours are banned and test-enforced.**
- **Tap targets `min-h-11`.**
- **Server Components by default**; `"use client"` needs PR justification. The files touched here
  are already client components.
- **`src/lib/muster/sweep.ts` must NOT import anything `server-only`.** A server-only value imported
  into the `"use client"` cockpit typechecks green and fails `next build` (#742 lesson). Run
  `pnpm build`, not just `pnpm typecheck`.
- **TDD, RED first.** First message of each task is the failing test.
- **Mutation-check every source-text or fixture assertion** — break the production code by hand,
  watch it RED, restore. `git status --porcelain` on the target paths BEFORE the first mutation; if
  it prints anything, commit first (`git checkout --` restores to HEAD, not to your working tree).

## Scope decision (deviation from the spec, deliberate)

The spec left open whether check-out gets the sweep. **This plan scopes the continuous sweep to
`session === "regular" && mode === "in"`** — the morning line. `ออก` and `OT` keep today's one-shot
behaviour, unchanged.

Rationale: it removes the silent-mass-check-out hazard by construction rather than by relying on the
SA reading a header, it is the only flow the operator described ("they line up every morning in
teams, we will scan from there"), and extending to `ออก` later is purely additive. The pinned action
header (Task 4) still renders in **all** modes, so the SA always knows which mode they are in.

**If the operator answers "yes, check-out too", update the spec and add a follow-up task** — do not
widen the mode gate silently.

## File Structure

| File                                                             | Responsibility                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Create** `src/lib/muster/sweep.ts`                             | Pure sweep reducer: outcome classification, cooldown, tally state. No React, no I/O, no `server-only`. |
| **Create** `src/lib/muster/scan-cue.ts`                          | Audible + haptic cue. Isolated because `AudioContext`/`navigator.vibrate` do not exist in jsdom.       |
| **Modify** `src/lib/muster/load-muster.ts`                       | Add `priorTeamByWorker` to `MusterBoard` (fold in `shapeMusterBoard`, fetch in `loadMusterBoard`).     |
| **Modify** `src/components/features/muster/muster-add-sheet.tsx` | Pinned action header, running tally, tap-add disclosure (U2).                                          |
| **Modify** `src/components/features/muster/muster-cockpit.tsx`   | Stop closing on decode, drive the reducer, defer `router.refresh()` to close.                          |
| **Create** `tests/unit/muster-sweep.test.ts`                     | Reducer tests.                                                                                         |
| **Create** `tests/unit/muster-scan-cue.test.ts`                  | Cue module absence/presence tests.                                                                     |
| **Modify** `tests/unit/load-muster.test.ts`                      | `priorTeamByWorker` fold tests.                                                                        |
| **Modify** `tests/unit/muster-cockpit.test.tsx`                  | Sheet-stays-open + tally render tests.                                                                 |

---

### Task 1: The pure sweep reducer

**Files:**

- Create: `src/lib/muster/sweep.ts`
- Test: `tests/unit/muster-sweep.test.ts`

**Interfaces:**

- Consumes: nothing (leaf module).
- Produces: `SCAN_COOLDOWN_MS`, `EMPTY_SWEEP`, types `SweepOutcomeKind`, `SweepEntry`,
  `SweepState`, `SweepContext`, `ClassifiedScan`; functions
  `isCoolingDown(state: SweepState, workerId: string, nowMs: number): boolean`,
  `classifyScan(ctx: SweepContext, workerId: string): ClassifiedScan`,
  `recordScan(state: SweepState, c: ClassifiedScan, nowMs: number): SweepState`,
  `markFailed(state: SweepState, workerId: string, error: string): SweepState`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/muster-sweep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EMPTY_SWEEP,
  SCAN_COOLDOWN_MS,
  classifyScan,
  isCoolingDown,
  markFailed,
  recordScan,
  type SweepContext,
} from "@/lib/muster/sweep";

const TEAM = "team-nan";
const OTHER = "team-chan";

const LEAD_A = "lead-a";
const LEAD_B = "lead-b";

function ctx(over: Partial<SweepContext> = {}): SweepContext {
  return {
    teamId: TEAM,
    leadWorkerId: LEAD_A,
    workersById: new Map([
      ["w1", "จรูญ โสภา"],
      ["w2", "มิตร ฮามศรีพรม"],
      ["w3", "ปาณิศา บุญเรือง"],
    ]),
    todayTeamByWorker: new Map(),
    teamLeadById: new Map([
      [TEAM, "อนันต์ แสงทอง"],
      [OTHER, "จันทร์ เงางาม"],
    ]),
    priorLeadByWorker: new Map(),
    addedThisSweep: new Set<string>(),
    ...over,
  };
}

describe("classifyScan", () => {
  it("adds a worker with no prior muster as first-time", () => {
    const c = classifyScan(ctx(), "w1");
    expect(c.kind).toBe("added_first_time");
    expect(c.name).toBe("จรูญ โสภา");
    expect(c.shouldWrite).toBe(true);
  });

  it("adds a worker whose last muster was this same lead, with no warning", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_A, name: "อนันต์ แสงทอง" }]]) }),
      "w1",
    );
    expect(c.kind).toBe("added");
    expect(c.detail).toBeNull();
    expect(c.shouldWrite).toBe(true);
  });

  it("warns when the worker's last muster was a different lead", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_B, name: "จันทร์ เงางาม" }]]) }),
      "w1",
    );
    expect(c.kind).toBe("added_team_changed");
    expect(c.detail).toBe("จันทร์ เงางาม");
    expect(c.shouldWrite).toBe(true);
  });

  it("compares leads by ID, not display name — two leads may share a name", () => {
    const c = classifyScan(
      ctx({ priorLeadByWorker: new Map([["w1", { id: LEAD_B, name: "อนันต์ แสงทอง" }]]) }),
      "w1",
    );
    expect(c.kind).toBe("added_team_changed");
  });

  it("reports a worker already on THIS team without writing", () => {
    const c = classifyScan(ctx({ todayTeamByWorker: new Map([["w1", TEAM]]) }), "w1");
    expect(c.kind).toBe("already_here");
    expect(c.shouldWrite).toBe(false);
  });

  it("counts a worker added earlier in this same sweep as already here", () => {
    const c = classifyScan(ctx({ addedThisSweep: new Set(["w1"]) }), "w1");
    expect(c.kind).toBe("already_here");
    expect(c.shouldWrite).toBe(false);
  });

  it("names the other team when the worker is mustered elsewhere today", () => {
    const c = classifyScan(ctx({ todayTeamByWorker: new Map([["w1", OTHER]]) }), "w1");
    expect(c.kind).toBe("other_team");
    expect(c.detail).toBe("จันทร์ เงางาม");
    expect(c.shouldWrite).toBe(false);
  });

  it("rejects a payload that is not a known worker", () => {
    const c = classifyScan(ctx(), "not-a-worker");
    expect(c.kind).toBe("unknown_badge");
    expect(c.shouldWrite).toBe(false);
  });
});

describe("isCoolingDown", () => {
  it("is false for a badge never seen", () => {
    expect(isCoolingDown(EMPTY_SWEEP, "w1", 1_000)).toBe(false);
  });

  it("suppresses a repeat inside the window and admits it after", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(isCoolingDown(s, "w1", 1_000 + SCAN_COOLDOWN_MS - 1)).toBe(true);
    expect(isCoolingDown(s, "w1", 1_000 + SCAN_COOLDOWN_MS)).toBe(false);
  });

  it("does not suppress a DIFFERENT badge", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(isCoolingDown(s, "w2", 1_100)).toBe(false);
  });
});

describe("recordScan", () => {
  it("puts the newest entry first", () => {
    let s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    s = recordScan(s, classifyScan(ctx(), "w2"), 5_000);
    expect(s.entries.map((e) => e.workerId)).toEqual(["w2", "w1"]);
  });

  it("tracks only successfully-writable scans in addedIds", () => {
    let s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    s = recordScan(
      s,
      classifyScan(ctx({ todayTeamByWorker: new Map([["w2", OTHER]]) }), "w2"),
      2_000,
    );
    expect(s.addedIds).toEqual(["w1"]);
  });

  it("does not mutate the previous state", () => {
    const before = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    const snapshot = before.entries.length;
    recordScan(before, classifyScan(ctx(), "w2"), 2_000);
    expect(before.entries.length).toBe(snapshot);
  });
});

describe("markFailed", () => {
  it("flips the worker's newest entry to failed and drops it from addedIds", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    const f = markFailed(s, "w1", "ไม่มีสิทธิ์เช็คชื่อ");
    expect(f.entries[0]?.outcome).toBe("failed");
    expect(f.entries[0]?.detail).toBe("ไม่มีสิทธิ์เช็คชื่อ");
    expect(f.addedIds).toEqual([]);
  });

  it("is a no-op for a worker with no entry", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(markFailed(s, "w9", "x")).toEqual(s);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test tests/unit/muster-sweep.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/muster/sweep"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/muster/sweep.ts`:

```ts
// Spec 359 U1 — the continuous-sweep reducer. The add sheet stays open across
// decodes, so the SA needs per-scan feedback without the board round-tripping.
// Everything decidable is decided HERE, as pure functions over board state:
//
//  - outcomes are classified from the board, NOT by parsing the RPC's Thai error
//    strings (scanErrorToThai is presentation; matching on it would couple the
//    sweep to copy),
//  - the cooldown exists because the decode loop fires every ~180ms and a badge
//    stays in frame while the SA moves on — one badge would otherwise fire ~5
//    writes/second. muster_scan_in is idempotent so there is no data damage, but
//    the tally would flood and it burns network on a site connection.
//
// Client-safe by construction: no React, no I/O, and NOTHING server-only (a
// server-only import reaching the "use client" cockpit typechecks green and
// fails `next build` — the #742 lesson).

/** How long the same badge payload is ignored after a scan. */
export const SCAN_COOLDOWN_MS = 3000;

export type SweepOutcomeKind =
  /** Added; their last muster was this same lead. */
  | "added"
  /** Added, but their last muster was a DIFFERENT lead — warn, never block. */
  | "added_team_changed"
  /** Added; no prior muster on record. */
  | "added_first_time"
  /** Already on this team (board or earlier in this sweep). No write. */
  | "already_here"
  /** Mustered on another team today. No write; offer ย้าย after the sweep. */
  | "other_team"
  /** Payload is not a worker on the active roster. */
  | "unknown_badge"
  /** The write was attempted and the server refused. */
  | "failed";

export interface SweepEntry {
  /** Monotonic within a sweep; React key. */
  seq: number;
  workerId: string;
  /** Resolved display name, or the raw payload for an unknown badge. */
  name: string;
  outcome: SweepOutcomeKind;
  /** Prior lead / other team's lead / error message. Null when there is nothing to add. */
  detail: string | null;
}

export interface SweepState {
  /** Newest first. */
  entries: SweepEntry[];
  /** Workers this sweep has successfully queued a write for. */
  addedIds: string[];
  /** workerId → epoch ms of the last accepted decode, for the cooldown. */
  lastSeen: Record<string, number>;
  seq: number;
}

export const EMPTY_SWEEP: SweepState = { entries: [], addedIds: [], lastSeen: {}, seq: 0 };

export interface SweepContext {
  /** The team whose sheet is open. */
  teamId: string;
  /** This team's LEAD WORKER id — the team-change comparison keys on this, not
   *  on the display name: surnames repeat across this roster (three แสงทอง on
   *  PRC-2026-004 alone) and a name collision would silently suppress a warning. */
  leadWorkerId: string;
  /** Active roster: worker id → display name. */
  workersById: ReadonlyMap<string, string>;
  /** Worker id → the team they are already on TODAY, from the board. */
  todayTeamByWorker: ReadonlyMap<string, string>;
  /** Team id → lead name, so another team can be named. */
  teamLeadById: ReadonlyMap<string, string>;
  /** Worker id → the lead of their LAST PRIOR muster. Absent = never mustered.
   *  Carries both id (for the comparison) and name (for the tally copy). */
  priorLeadByWorker: ReadonlyMap<string, { id: string; name: string }>;
  /** Added earlier in this same sweep (the board is stale until the sheet closes). */
  addedThisSweep: ReadonlySet<string>;
}

export interface ClassifiedScan {
  workerId: string;
  name: string;
  kind: SweepOutcomeKind;
  detail: string | null;
  /** True only when a muster_scan_in call should follow. */
  shouldWrite: boolean;
}

export function isCoolingDown(state: SweepState, workerId: string, nowMs: number): boolean {
  const last = state.lastSeen[workerId];
  return last !== undefined && nowMs - last < SCAN_COOLDOWN_MS;
}

export function classifyScan(ctx: SweepContext, workerId: string): ClassifiedScan {
  const name = ctx.workersById.get(workerId);
  if (name === undefined) {
    return { workerId, name: workerId, kind: "unknown_badge", detail: null, shouldWrite: false };
  }
  // The board is only refreshed when the sheet closes, so a worker added earlier
  // in THIS sweep is not yet in todayTeamByWorker — check both.
  if (ctx.addedThisSweep.has(workerId)) {
    return { workerId, name, kind: "already_here", detail: null, shouldWrite: false };
  }
  const todayTeam = ctx.todayTeamByWorker.get(workerId);
  if (todayTeam !== undefined) {
    if (todayTeam === ctx.teamId) {
      return { workerId, name, kind: "already_here", detail: null, shouldWrite: false };
    }
    return {
      workerId,
      name,
      kind: "other_team",
      detail: ctx.teamLeadById.get(todayTeam) ?? null,
      shouldWrite: false,
    };
  }
  const priorLead = ctx.priorLeadByWorker.get(workerId);
  if (priorLead === undefined) {
    return { workerId, name, kind: "added_first_time", detail: null, shouldWrite: true };
  }
  if (priorLead.id !== ctx.leadWorkerId) {
    return {
      workerId,
      name,
      kind: "added_team_changed",
      detail: priorLead.name,
      shouldWrite: true,
    };
  }
  return { workerId, name, kind: "added", detail: null, shouldWrite: true };
}

export function recordScan(state: SweepState, c: ClassifiedScan, nowMs: number): SweepState {
  const seq = state.seq + 1;
  return {
    entries: [
      { seq, workerId: c.workerId, name: c.name, outcome: c.kind, detail: c.detail },
      ...state.entries,
    ],
    addedIds: c.shouldWrite ? [...state.addedIds, c.workerId] : state.addedIds,
    lastSeen: { ...state.lastSeen, [c.workerId]: nowMs },
    seq,
  };
}

export function markFailed(state: SweepState, workerId: string, error: string): SweepState {
  const idx = state.entries.findIndex((e) => e.workerId === workerId);
  if (idx === -1) return state;
  const entries = state.entries.map((e, i) =>
    i === idx ? { ...e, outcome: "failed" as const, detail: error } : e,
  );
  return {
    ...state,
    entries,
    addedIds: state.addedIds.filter((id) => id !== workerId),
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test tests/unit/muster-sweep.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Mutation-check three assertions**

Pre-flight — if this prints anything, commit first:

```bash
git status --porcelain -- src/lib/muster/sweep.ts tests/unit/muster-sweep.test.ts
```

Then, one at a time, break it by hand, run the test, watch it RED, restore by hand:

1. In `classifyScan`, change `priorLead.id !== ctx.leadWorkerId` to `===` → the team-change test
   must fail.
2. In `isCoolingDown`, change `<` to `<=` → the boundary test must fail.
3. Drop the `addedThisSweep` short-circuit in `classifyScan` → the "added earlier in this same
   sweep" test must fail.
4. Change `priorLead.id !== ctx.leadWorkerId` to compare `priorLead.name` against a name → the
   "compares leads by ID" test must fail.

Confirm the tree came back:

```bash
git status --porcelain -- src/lib/muster/sweep.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/muster/sweep.ts tests/unit/muster-sweep.test.ts
git commit -m "feat(muster): pure continuous-sweep reducer (spec 359 U1)"
```

---

### Task 2: Prior muster team per worker

**Files:**

- Modify: `src/lib/muster/load-muster.ts` (`MusterBoard`, `shapeMusterBoard`, `loadMusterBoard`)
- Test: `tests/unit/load-muster.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces:
  `MusterBoard.priorTeamByWorker: { workerId: string; leadWorkerId: string; leadName: string }[]` —
  the lead of each worker's most recent muster **before** `date`. A worker with no prior muster is
  absent from the array. Task 5 folds it into `SweepContext.priorLeadByWorker`.

⚠️ **Expected RED beyond this task's own tests.** `priorTeamByWorker` is a **required** field on
`MusterBoard`, so the two fixtures that construct one (`tests/unit/load-muster.test.ts` and the
`BOARD` const in `tests/unit/muster-cockpit.test.tsx`) stop typechecking until each gains
`priorTeamByWorker: []`. That is the exhaustiveness guard doing its job — add the field, never widen
the type to optional. `src/lib/muster/day-summary.ts` also consumes `MusterBoard`; it reads only
`teams`, so it needs no change — confirm rather than assume.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/load-muster.test.ts`:

```ts
describe("shapeMusterBoard — priorTeamByWorker (spec 359 U1)", () => {
  const workers = [
    { id: "w1", name: "จรูญ โสภา", gender: null },
    { id: "w2", name: "มิตร ฮามศรีพรม", gender: null },
    { id: "lead-a", name: "อนันต์ แสงทอง", gender: null },
    { id: "lead-b", name: "จันทร์ เงางาม", gender: null },
  ];

  it("resolves each worker's most recent prior team to its lead NAME", () => {
    const board = shapeMusterBoard({
      teams: [],
      attendance: [],
      teamWps: [],
      workers,
      wps: [],
      priorAttendance: [
        { workerId: "w1", leadWorkerId: "lead-a", workDate: "2026-07-24" },
        { workerId: "w1", leadWorkerId: "lead-b", workDate: "2026-07-22" },
      ],
    });
    expect(board.priorTeamByWorker).toEqual([
      { workerId: "w1", leadWorkerId: "lead-a", leadName: "อนันต์ แสงทอง" },
    ]);
  });

  it("omits a worker with no prior muster entirely", () => {
    const board = shapeMusterBoard({
      teams: [],
      attendance: [],
      teamWps: [],
      workers,
      wps: [],
      priorAttendance: [{ workerId: "w1", leadWorkerId: "lead-a", workDate: "2026-07-24" }],
    });
    expect(board.priorTeamByWorker.some((p) => p.workerId === "w2")).toBe(false);
  });

  it("takes the LATEST date regardless of input order", () => {
    const board = shapeMusterBoard({
      teams: [],
      attendance: [],
      teamWps: [],
      workers,
      wps: [],
      priorAttendance: [
        { workerId: "w1", leadWorkerId: "lead-b", workDate: "2026-07-22" },
        { workerId: "w1", leadWorkerId: "lead-a", workDate: "2026-07-24" },
      ],
    });
    expect(board.priorTeamByWorker).toEqual([
      { workerId: "w1", leadWorkerId: "lead-a", leadName: "อนันต์ แสงทอง" },
    ]);
  });

  it("is empty when no prior attendance is supplied", () => {
    const board = shapeMusterBoard({
      teams: [],
      attendance: [],
      teamWps: [],
      workers,
      wps: [],
    });
    expect(board.priorTeamByWorker).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test tests/unit/load-muster.test.ts
```

Expected: FAIL — `priorTeamByWorker` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/lib/muster/load-muster.ts`, add to the `MusterBoard` interface (after `closure`):

```ts
// Spec 359 U1 — each worker's most recent muster BEFORE this date. Drives the
// sweep's team-change warning: the comparison keys on leadWorkerId (names
// repeat across the roster), the copy uses leadName. A worker who has never
// mustered is absent (the sweep renders ครั้งแรก for them).
priorTeamByWorker: {
  workerId: string;
  leadWorkerId: string;
  leadName: string;
}
[];
```

Add to the `shapeMusterBoard` parameter type (after `crewRosters`):

```ts
  // Spec 359 U1 — flat prior-day attendance rows, any order.
  priorAttendance?: { workerId: string; leadWorkerId: string; workDate: string }[];
```

Inside `shapeMusterBoard`, before the `return`:

```ts
// Spec 359 U1 — latest prior muster per worker. Compared by ISO date string,
// which sorts lexicographically. The lead is resolved to a NAME here so the
// client reducer never has to hold an id→name map for leads who are not on
// today's board.
const latestPrior = new Map<string, { leadWorkerId: string; workDate: string }>();
for (const row of raw.priorAttendance ?? []) {
  const seen = latestPrior.get(row.workerId);
  if (!seen || row.workDate > seen.workDate) {
    latestPrior.set(row.workerId, { leadWorkerId: row.leadWorkerId, workDate: row.workDate });
  }
}
const priorTeamByWorker = [...latestPrior.entries()].map(([workerId, v]) => ({
  workerId,
  leadWorkerId: v.leadWorkerId,
  leadName: nameOf(v.leadWorkerId),
}));
```

Add `priorTeamByWorker` to the returned object.

In `loadMusterBoard`, after the `crewRosters` block and before the `return shapeMusterBoard({...})`:

```ts
// Spec 359 U1 — prior muster rows for this project, so the sweep can warn when
// a worker turns up in a different line from last time. Two reads because
// PostgREST cannot join: prior teams, then their attendance.
//
// Unbounded backwards, matching loadUnclosedPriorDays: a date window would make
// a returning worker after a long gap indistinguishable from a first-timer, and
// silently mislabel them ครั้งแรก. Rows are three small columns and only exist
// for days a team was actually opened, so the read stays modest; if a project
// ever accumulates years of muster this is the query to revisit.
const { data: priorTeamRows } = await supabase
  .from("muster_teams")
  .select("id, lead_worker_id, work_date")
  .eq("project_id", projectId)
  .lt("work_date", date);
const priorTeamById = new Map((priorTeamRows ?? []).map((t) => [t.id, t]));
const priorAttendanceRes = priorTeamById.size
  ? await supabase
      .from("muster_attendance")
      .select("team_id, worker_id")
      .in("team_id", [...priorTeamById.keys()])
      .eq("session", "regular")
  : { data: [] as { team_id: string; worker_id: string }[] };
const priorAttendance = (priorAttendanceRes.data ?? []).flatMap((a) => {
  const t = priorTeamById.get(a.team_id);
  return t
    ? [{ workerId: a.worker_id, leadWorkerId: t.lead_worker_id, workDate: t.work_date }]
    : [];
});
```

and pass `priorAttendance` into the `shapeMusterBoard({...})` call.

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test tests/unit/load-muster.test.ts
```

Expected: PASS.

- [ ] **Step 5: Mutation-check**

Change `row.workDate > seen.workDate` to `<` → the "takes the LATEST date" test must fail. Restore
by hand, then confirm:

```bash
git status --porcelain -- src/lib/muster/load-muster.ts
```

- [ ] **Step 6: Verify against the live database**

The fold is unit-tested; the QUERY is not. Prove it returns real rows:

```bash
pnpm exec supabase db query --linked "select w.name||' last mustered '||max(mt.work_date)::text||' under '||(select lw.name from workers lw where lw.id = mt.lead_worker_id) as r from muster_attendance ma join muster_teams mt on mt.id = ma.team_id join workers w on w.id = ma.worker_id where mt.project_id = 'a88af871-019b-4eca-a7aa-f05244c83e5d' and mt.work_date < '2026-07-25' and ma.session = 'regular' group by w.name, mt.lead_worker_id order by 1"
```

Expected: rows for the 2026-07-24 muster — 13 workers under อนันต์ แสงทอง / จันทร์ เงางาม.

- [ ] **Step 7: Commit**

```bash
git add src/lib/muster/load-muster.ts tests/unit/load-muster.test.ts
git commit -m "feat(muster): expose each worker's prior muster team (spec 359 U1)"
```

---

### Task 3: The scan cue (audible + haptic)

**Files:**

- Create: `src/lib/muster/scan-cue.ts`
- Test: `tests/unit/muster-scan-cue.test.ts`

**Interfaces:**

- Consumes: `SweepOutcomeKind` from Task 1.
- Produces: `playScanCue(kind: SweepOutcomeKind): void` — fire-and-forget, never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/muster-scan-cue.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { playScanCue } from "@/lib/muster/scan-cue";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("playScanCue", () => {
  it("does not throw when neither AudioContext nor vibrate exists", () => {
    expect(() => playScanCue("added")).not.toThrow();
  });

  it("vibrates a short pulse for an added worker", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    playScanCue("added");
    expect(vibrate).toHaveBeenCalledWith([40]);
  });

  it("vibrates a distinct double pulse for a warning outcome", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    playScanCue("added_team_changed");
    expect(vibrate).toHaveBeenCalledWith([40, 60, 40]);
  });

  it("vibrates a long pulse for a rejected scan", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    playScanCue("other_team");
    expect(vibrate).toHaveBeenCalledWith([180]);
  });

  it("survives a vibrate implementation that throws", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        throw new Error("blocked");
      },
      configurable: true,
    });
    expect(() => playScanCue("added")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test tests/unit/muster-scan-cue.test.ts
```

Expected: FAIL — cannot resolve `@/lib/muster/scan-cue`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/muster/scan-cue.ts`:

```ts
// Spec 359 U1 — per-scan feedback for the continuous sweep. The SA is watching
// the LINE, not the screen, so a purely visual tally would just relocate the
// friction it exists to remove: they would have to look down after every worker.
//
// Both channels are best-effort and independently optional. iOS Safari has no
// navigator.vibrate at all, and an AudioContext may be blocked until a user
// gesture — the sweep must degrade to visual-only rather than throw mid-line.

import type { SweepOutcomeKind } from "./sweep";

/** Vibration patterns, in ms. Three shapes so they are told apart by feel alone. */
const PATTERN: Record<SweepOutcomeKind, number[]> = {
  added: [40],
  added_first_time: [40],
  added_team_changed: [40, 60, 40],
  already_here: [20],
  other_team: [180],
  unknown_badge: [180],
  failed: [180],
};

/** Tone frequency in Hz, paired with the pattern above. */
const TONE: Record<SweepOutcomeKind, number> = {
  added: 880,
  added_first_time: 880,
  added_team_changed: 660,
  already_here: 520,
  other_team: 300,
  unknown_badge: 300,
  failed: 300,
};

type AudioCtor = new () => AudioContext;

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function beep(hz: number, ms: number): void {
  const ac = audioContext();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = hz;
  // A bare square wave clips audibly; a small fixed gain keeps it a chirp.
  gain.gain.value = 0.08;
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + ms / 1000);
}

export function playScanCue(kind: SweepOutcomeKind): void {
  try {
    navigator.vibrate?.(PATTERN[kind]);
  } catch {
    // A blocked or throwing vibrate must never abort the sweep.
  }
  try {
    beep(
      TONE[kind],
      PATTERN[kind].reduce((a, b) => a + b, 0),
    );
  } catch {
    // Same for audio — autoplay policy, no output device, a stub in tests.
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test tests/unit/muster-scan-cue.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/muster/scan-cue.ts tests/unit/muster-scan-cue.test.ts
git commit -m "feat(muster): audible + haptic scan cue (spec 359 U1)"
```

---

### Task 4: Sheet — pinned action header and running tally

**Files:**

- Modify: `src/components/features/muster/muster-add-sheet.tsx`
- Test: `tests/unit/muster-cockpit.test.tsx`

**Interfaces:**

- Consumes: `SweepEntry`, `SweepOutcomeKind` from Task 1.
- Produces: `MusterAddSheet` gains three required props —
  `actionLabel: string` (the verb line, e.g. `กำลังเช็คเข้า`),
  `sessionLabel: string` (`งานปกติ` | `OT`),
  `sweep: SweepEntry[]` (newest first; empty in non-sweep modes).
  `leadName`, `hasCamera`, `showTapAdd`, `addable`, `message`, `pending`, `onScanDetected`,
  `onTapAdd`, `onClose` keep their current signatures.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/muster-cockpit.test.tsx`:

```tsx
import { MusterAddSheet } from "@/components/features/muster/muster-add-sheet";

describe("MusterAddSheet — action header + tally (spec 359 U1)", () => {
  const base = {
    leadName: "อนันต์ แสงทอง",
    actionLabel: "กำลังเช็คเข้า",
    sessionLabel: "งานปกติ",
    hasCamera: true,
    showTapAdd: true,
    addable: [],
    message: null,
    pending: false,
    sweep: [],
    onScanDetected: () => {},
    onTapAdd: () => {},
    onClose: () => {},
  };

  it("names the action, the team and the session in one header line", () => {
    render(<MusterAddSheet {...base} />);
    const header = screen.getByTestId("sweep-action-header");
    expect(header.textContent).toContain("กำลังเช็คเข้า");
    expect(header.textContent).toContain("อนันต์ แสงทอง");
    expect(header.textContent).toContain("งานปกติ");
  });

  it("states the check-OUT verb when that is the active mode", () => {
    render(<MusterAddSheet {...base} actionLabel="กำลังเช็คออก" />);
    expect(screen.getByTestId("sweep-action-header").textContent).toContain("กำลังเช็คออก");
    expect(screen.getByTestId("sweep-action-header").textContent).not.toContain("กำลังเช็คเข้า");
  });

  it("counts only the added outcomes, not the refused ones", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 3, workerId: "w3", name: "ค", outcome: "other_team", detail: "จันทร์ เงางาม" },
          { seq: 2, workerId: "w2", name: "ข", outcome: "added_first_time", detail: null },
          { seq: 1, workerId: "w1", name: "ก", outcome: "added", detail: null },
        ]}
      />,
    );
    expect(screen.getByTestId("sweep-count").textContent).toContain("2");
  });

  it("renders entries newest first", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 2, workerId: "w2", name: "ข", outcome: "added", detail: null },
          { seq: 1, workerId: "w1", name: "ก", outcome: "added", detail: null },
        ]}
      />,
    );
    const names = screen.getAllByTestId("sweep-entry-name").map((n) => n.textContent);
    expect(names).toEqual(["ข", "ก"]);
  });

  it("shows the prior lead on a team change", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          {
            seq: 1,
            workerId: "w1",
            name: "ก",
            outcome: "added_team_changed",
            detail: "จันทร์ เงางาม",
          },
        ]}
      />,
    );
    expect(screen.getByText(/เมื่อวานอยู่ทีม จันทร์ เงางาม/)).toBeInTheDocument();
  });

  it("labels a never-before-mustered worker", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[{ seq: 1, workerId: "w1", name: "ก", outcome: "added_first_time", detail: null }]}
      />,
    );
    expect(screen.getByText("ครั้งแรก")).toBeInTheDocument();
  });

  it("names the other team when the worker is mustered elsewhere", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[
          { seq: 1, workerId: "w1", name: "ก", outcome: "other_team", detail: "จันทร์ เงางาม" },
        ]}
      />,
    );
    expect(screen.getByText(/อยู่ทีม จันทร์ เงางาม แล้ววันนี้/)).toBeInTheDocument();
  });

  it("reports an unreadable badge without a name", () => {
    render(
      <MusterAddSheet
        {...base}
        sweep={[{ seq: 1, workerId: "junk", name: "junk", outcome: "unknown_badge", detail: null }]}
      />,
    );
    expect(screen.getByText("ไม่รู้จักบัตรนี้")).toBeInTheDocument();
  });

  it("renders no tally block at all before the first scan", () => {
    render(<MusterAddSheet {...base} sweep={[]} />);
    expect(screen.queryByTestId("sweep-count")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm exec vitest run tests/unit/muster-cockpit.test.tsx -t "action header"
```

Expected: FAIL — `Unable to find an element by: [data-testid="sweep-action-header"]`.

- [ ] **Step 3: Write the implementation**

In `src/components/features/muster/muster-add-sheet.tsx`, import the entry type:

```tsx
import type { SweepEntry, SweepOutcomeKind } from "@/lib/muster/sweep";
```

Add the per-outcome copy SSOT above the component:

```tsx
// Spec 359 U1 — the tally's per-outcome line. `detail` fills the placeholder
// where one is present (prior lead / other team's lead / server message).
const OUTCOME_NOTE: Record<SweepOutcomeKind, (detail: string | null) => string | null> = {
  added: () => null,
  added_first_time: () => "ครั้งแรก",
  added_team_changed: (d) => (d ? `เมื่อวานอยู่ทีม ${d}` : "เปลี่ยนทีมจากครั้งก่อน"),
  already_here: () => "อยู่ในทีมแล้ว",
  other_team: (d) => (d ? `อยู่ทีม ${d} แล้ววันนี้` : "อยู่ทีมอื่นแล้ววันนี้"),
  unknown_badge: () => "ไม่รู้จักบัตรนี้",
  failed: (d) => d ?? "เช็คชื่อไม่สำเร็จ",
};

// Outcomes that actually put someone on the team — the only ones the count
// includes. A refused scan must never inflate "เพิ่มแล้ว N คน".
const ADDED_KINDS: ReadonlySet<SweepOutcomeKind> = new Set([
  "added",
  "added_first_time",
  "added_team_changed",
]);

const NEEDS_ATTENTION: ReadonlySet<SweepOutcomeKind> = new Set([
  "added_team_changed",
  "other_team",
  "unknown_badge",
  "failed",
]);
```

Extend the props destructure with `actionLabel`, `sessionLabel`, `sweep`, and their types
(`actionLabel: string; sessionLabel: string; sweep: SweepEntry[];`).

Inside the panel `<div>`, **above** the `{hasCamera ? <MusterCamera … /> : null}` line:

```tsx
{
  /* Spec 359 U1 — the action header. States the VERB, not a toggle state:
            the cockpit's เข้า/ออก and งานปกติ/OT toggles decide what a decode
            does, and under a continuous sweep a wrong mode would check a whole
            team out in seconds without the SA noticing. Pinned so it survives
            scrolling the tally. */
}
<div data-testid="sweep-action-header" className="bg-card rounded-card sticky top-0 z-10 px-3 py-2">
  <p className="text-ink text-sm font-bold">
    {actionLabel} · ทีม {leadName} · {sessionLabel}
  </p>
</div>;
```

Immediately **below** the camera and above the `{message …}` block:

```tsx
{
  sweep.length > 0 ? (
    <div className="bg-card rounded-card flex flex-col gap-2 p-3">
      <p data-testid="sweep-count" className="text-ink text-sm font-bold">
        เพิ่มแล้ว {sweep.filter((e) => ADDED_KINDS.has(e.outcome)).length} คน
      </p>
      {/* aria-live so a screen-reader SA hears each outcome without looking. */}
      <ul role="status" aria-live="polite" className="flex flex-col gap-1.5">
        {sweep.map((e) => {
          const note = OUTCOME_NOTE[e.outcome](e.detail);
          const attention = NEEDS_ATTENTION.has(e.outcome);
          return (
            <li key={e.seq} className="flex flex-wrap items-center gap-2">
              <span data-testid="sweep-entry-name" className="text-ink text-sm font-semibold">
                {e.outcome === "unknown_badge" ? "—" : e.name}
              </span>
              {note ? (
                <span
                  className={`text-meta rounded-full px-2 py-0.5 font-semibold ${
                    attention ? "bg-attn-soft text-attn-ink" : "bg-sunk text-ink-secondary"
                  }`}
                >
                  {note}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm test tests/unit/muster-cockpit.test.tsx
```

Expected: PASS — the 9 new tests plus every pre-existing one.

- [ ] **Step 5: Mutation-check the count assertion**

Change `sweep.filter((e) => ADDED_KINDS.has(e.outcome)).length` to `sweep.length` → the
"counts only the added outcomes" test must fail. Restore by hand and confirm with `git status`.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/muster/muster-add-sheet.tsx tests/unit/muster-cockpit.test.tsx
git commit -m "feat(muster): sweep action header + running tally in the add sheet (spec 359 U1)"
```

---

### Task 5: Cockpit — stop closing on decode, drive the sweep

**Files:**

- Modify: `src/components/features/muster/muster-cockpit.tsx`
- Test: `tests/unit/muster-cockpit.test.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1-4.
- Produces: no new exports. `MusterCockpit`'s props are unchanged.

- [ ] **Step 1a: Upgrade two existing mocks in `tests/unit/muster-cockpit.test.tsx`**

The file's current mocks cannot express these assertions: the camera double fires a **fixed** worker
id, and `useRouter` returns a **new** `refresh` fn on every call so nothing can be asserted on it.
Both changes are backward-compatible — every existing test keeps passing.

Replace the `next/navigation` mock (add the stable fn above it, beside the other action consts):

```tsx
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
```

Replace the camera mock, keeping the original fixed-id button so existing tests are untouched and
adding a settable one for the sweep:

```tsx
// The camera loop is untestable in jsdom (getUserMedia/BarcodeDetector absent) —
// mock the component; the sheet's camera MOUNT decision + the onDetected wiring
// are what these tests pin. `camera-mock` fires a fixed worker id (=W3 below;
// vi.mock hoists above the consts, so the literal is repeated here).
// Spec 359: `camera-mock-next` fires whatever id the test last put in
// `nextScanId`, so a sweep over several badges can be driven.
const nextScanId = { current: "cccccccc-3333-3333-3333-333333333333" };
vi.mock("@/components/features/muster/muster-camera", () => ({
  MusterCamera: (p: { onDetected: (id: string) => void }) => (
    <>
      <button
        type="button"
        data-testid="camera-mock"
        onClick={() => p.onDetected("cccccccc-3333-3333-3333-333333333333")}
      />
      <button
        type="button"
        data-testid="camera-mock-next"
        onClick={() => p.onDetected(nextScanId.current)}
      />
    </>
  ),
}));
```

Add `beforeEach(() => { refresh.mockClear(); });` to the file's existing `beforeEach` body, and
`import { act } from "react";`.

- [ ] **Step 1b: Write the failing test**

Append to `tests/unit/muster-cockpit.test.tsx`. `BOARD`, `W1`–`W3`, `T1`, `PROJECT` and the
`musterScan` mock are the file's existing consts — reuse them, do not redefine.

```tsx
describe("MusterCockpit — continuous sweep (spec 359 U1)", () => {
  // W1 is already a member of T1 in BOARD; W2 and W3 are on the roster only.
  const renderSweep = (board: MusterBoard = BOARD) =>
    render(
      <MusterCockpit
        projectId={PROJECT}
        date="2026-07-26"
        revalidate="/projects/x/muster"
        board={board}
        htWorkerIds={[W1]}
        pastDayEnd={false}
      />,
    );

  const openSheet = () => userEvent.click(screen.getByLabelText("สแกน QR / เพิ่มช่าง"));
  const scan = async (id: string) => {
    nextScanId.current = id;
    await act(async () => {
      await userEvent.click(screen.getByTestId("camera-mock-next"));
    });
  };

  beforeEach(() => {
    musterScan.mockResolvedValue({ ok: true, id: "row-1" });
  });

  it("keeps the sheet open after a successful decode", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    expect(screen.getByTestId("sweep-action-header")).toBeInTheDocument();
    expect(screen.getByTestId("sweep-count")).toBeInTheDocument();
  });

  it("scans as qr, check-in, regular session", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    expect(musterScan).toHaveBeenCalledWith(
      expect.objectContaining({ method: "qr", mode: "in", session: "regular", workerId: W2 }),
    );
  });

  it("writes once per badge and ignores a repeat inside the cooldown", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await scan(W2);
    expect(musterScan).toHaveBeenCalledTimes(1);
  });

  it("accumulates several different badges in one sweep", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await scan(W3);
    expect(musterScan).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("sweep-count").textContent).toContain("2");
  });

  it("does not call the server for a worker already on this team", async () => {
    renderSweep();
    await openSheet();
    await scan(W1); // already a member of T1 in BOARD
    expect(musterScan).not.toHaveBeenCalled();
    expect(screen.getByText("อยู่ในทีมแล้ว")).toBeInTheDocument();
  });

  it("refreshes the board once, on close — not per scan", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await scan(W3);
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("ปิด"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("marks the entry failed when the server refuses", async () => {
    musterScan.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์เช็คชื่อ" });
    renderSweep();
    await openSheet();
    await scan(W2);
    expect(await screen.findByText("ไม่มีสิทธิ์เช็คชื่อ")).toBeInTheDocument();
    expect(screen.getByTestId("sweep-count").textContent).toContain("0");
  });

  it("starts each sheet opening with an empty tally", async () => {
    renderSweep();
    await openSheet();
    await scan(W2);
    await userEvent.click(screen.getByText("ปิด"));
    await openSheet();
    expect(screen.queryByTestId("sweep-count")).not.toBeInTheDocument();
  });

  it("warns when the worker's last muster was a different lead", async () => {
    renderSweep({
      ...BOARD,
      priorTeamByWorker: [{ workerId: W2, leadWorkerId: W3, leadName: "ก้อง" }],
    });
    await openSheet();
    await scan(W2);
    expect(screen.getByText("เมื่อวานอยู่ทีม ก้อง")).toBeInTheDocument();
  });

  it("does not sweep in ออก mode — that keeps the one-shot behaviour", async () => {
    renderSweep();
    await userEvent.click(screen.getByText("ออก"));
    await openSheet();
    await scan(W2);
    // Sheet closed → the header is gone.
    expect(screen.queryByTestId("sweep-action-header")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm exec vitest run tests/unit/muster-cockpit.test.tsx -t "continuous sweep"
```

Expected: FAIL — the sheet closes after the decode, so `sweep-action-header` is gone.

- [ ] **Step 3: Write the implementation**

Add the imports:

```tsx
import {
  EMPTY_SWEEP,
  classifyScan,
  isCoolingDown,
  markFailed,
  recordScan,
  type SweepState,
} from "@/lib/muster/sweep";
import { playScanCue } from "@/lib/muster/scan-cue";
```

Add the state beside the others:

```tsx
// Spec 359 U1 — the open sheet's running tally. Reset on every open so a new
// team never inherits the previous team's list.
const [sweep, setSweep] = useState<SweepState>(EMPTY_SWEEP);
```

Add the derived lookups after `addableTo`:

```tsx
// Spec 359 U1 — the sweep classifies from BOARD state rather than by matching
// the RPC's Thai error text, so the outcomes survive a copy change.
const todayTeamByWorker = new Map(
  board.teams.flatMap((t) => t.members.map((m) => [m.workerId, t.id] as const)),
);
const teamLeadById = new Map(board.teams.map((t) => [t.id, t.leadName] as const));
const workersById = new Map(board.workers.map((w) => [w.id, w.name] as const));
const priorLeadByWorker = new Map(
  board.priorTeamByWorker.map(
    (p) => [p.workerId, { id: p.leadWorkerId, name: p.leadName }] as const,
  ),
);
// The sweep is the morning line only: regular + เข้า. ออก and OT keep the
// one-shot behaviour (spec 359 plan, scope decision) — a continuous sweep in
// ออก would check a whole team out in seconds.
const sweepMode = session === "regular" && mode === "in";
```

Replace `scanFromCamera` with the sweep handler:

```tsx
// Spec 359 U1 — a decode inside the sweep. The board is NOT refreshed per scan
// (that would be a server round-trip and a re-render per worker in a line); the
// tally is the SA's feedback and the board catches up when the sheet closes.
const onSweepDetected = (teamId: string, workerId: string) => {
  const now = Date.now();
  // The decode loop fires every ~180ms and the badge stays in frame while the
  // SA moves on — without this, one badge is ~5 writes a second.
  if (isCoolingDown(sweep, workerId, now)) return;
  const c = classifyScan(
    {
      teamId,
      leadWorkerId: board.teams.find((t) => t.id === teamId)?.leadWorkerId ?? "",
      workersById,
      todayTeamByWorker,
      teamLeadById,
      priorLeadByWorker,
      addedThisSweep: new Set(sweep.addedIds),
    },
    workerId,
  );
  setSweep((s) => recordScan(s, c, now));
  playScanCue(c.kind);
  if (!c.shouldWrite) return;
  startTransition(async () => {
    const res = await musterScan({
      teamId,
      workerId,
      mode: "in",
      method: "qr",
      session: "regular",
      revalidate,
    });
    if (!res.ok) {
      setSweep((s) => markFailed(s, workerId, res.error));
      playScanCue("failed");
    }
  });
};

// Non-sweep modes (ออก, OT) keep the pre-359 one-shot behaviour.
const scanFromCamera = (teamId: string, workerId: string) =>
  session === "ot" ? scanOt(teamId, workerId, "qr") : scanRegular(teamId, workerId, "qr");

const closeSheet = () => {
  setScanTeamId(null);
  setSweep(EMPTY_SWEEP);
  // One refresh for the whole sweep.
  if (sweep.addedIds.length > 0) router.refresh();
};
```

Replace the sheet render block's props:

```tsx
<MusterAddSheet
  leadName={sheetTeam.leadName}
  actionLabel={
    session === "ot" ? "กำลังบันทึก OT" : mode === "in" ? "กำลังเช็คเข้า" : "กำลังเช็คออก"
  }
  sessionLabel={session === "ot" ? "OT" : "งานปกติ"}
  hasCamera={hasCamera}
  showTapAdd={session === "regular" && mode === "in"}
  addable={addableTo(sheetTeam.id)}
  message={message}
  pending={pending}
  sweep={sweep.entries}
  onScanDetected={(workerId) => {
    if (sweepMode) {
      onSweepDetected(sheetTeam.id, workerId);
      return;
    }
    scanFromCamera(sheetTeam.id, workerId);
    setScanTeamId(null);
  }}
  onTapAdd={(workerId) => onScanTap(sheetTeam.id, workerId)}
  onClose={closeSheet}
/>
```

And in `onOpenSheet` on the `TeamCard` call site, reset the tally:

```tsx
            onOpenSheet={() => {
              setMessage(null);
              setSweep(EMPTY_SWEEP);
              setScanTeamId(team.id);
            }}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm test tests/unit/muster-cockpit.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the whole suite, typecheck, lint and BUILD**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

```bash
pnpm build
```

`pnpm build` is not optional here: `sweep.ts` is imported as a **value** by a `"use client"`
component, and a stray `server-only` import in that chain typechecks green and fails only at build
(#742).

- [ ] **Step 6: Mutation-check two assertions**

1. Remove the `isCoolingDown` early return → "ignores a repeat inside the cooldown" must fail.
2. Change `if (sweep.addedIds.length > 0) router.refresh()` to call `router.refresh()` inside
   `onSweepDetected` → "refreshes the board once, on close" must fail.

Restore by hand after each; confirm with `git status --porcelain`.

- [ ] **Step 7: Real-flow verification (unit gate 4) — run at the END of Task 6**

U1 is not user-complete until Task 6 lands (an other-team row is a dead end without the move), so
run this once, there, rather than twice. It is written out here because it belongs to this task's
deliverable.

Start the dev server via the preview tooling (never `pnpm dev` in Bash), log in per the
`dev-preview-login` recipe, open `/projects/a88af871-019b-4eca-a7aa-f05244c83e5d/muster`, open a
team's QR door, and confirm: the header names the action, the tally accumulates, the sheet does not
close, zero console errors. Then prove the write landed:

```bash
pnpm exec supabase db query --linked "select w.name||' '||ma.in_method::text||' '||to_char(ma.in_at at time zone 'Asia/Bangkok','HH24:MI:SS') as r from muster_attendance ma join workers w on w.id=ma.worker_id where ma.work_date = current_date order by ma.in_at desc limit 5"
```

Expected: the scanned worker with `in_method = qr`.

- [ ] **Step 8: Commit — do NOT ship yet**

Task 6 completes U1 (the other-team rows are dead ends without it, and the spec promises the move).
Ship the two together.

```bash
git add src/components/features/muster/muster-cockpit.tsx tests/unit/muster-cockpit.test.tsx
git commit -m "feat(muster): continuous QR sweep in the add sheet (spec 359 U1)"
```

---

### Task 6: `ย้ายมาทีมนี้` for an other-team entry

The spec's other-team outcome promises the move is "offered **after** the sweep — not a modal in the
middle of a line of eight people". The affordance lives in the tally row, so it never interrupts:
the SA keeps scanning and deals with the amber rows when the line is done.

**Files:**

- Modify: `src/lib/muster/sweep.ts` (add `markMoved`)
- Modify: `src/components/features/muster/muster-add-sheet.tsx` (the row button)
- Modify: `src/components/features/muster/muster-cockpit.tsx` (wire `moveMusterWorker`)
- Test: `tests/unit/muster-sweep.test.ts`, `tests/unit/muster-cockpit.test.tsx`

**Interfaces:**

- Consumes: `moveMusterWorker` from `@/lib/muster/actions` — existing, signature
  `{ workerId: string; date: string; toTeamId: string; revalidate: string } => Promise<MusterResult>`.
- Produces: `markMoved(state: SweepState, workerId: string): SweepState`;
  `MusterAddSheet` gains `onMoveHere: (workerId: string) => void`.

- [ ] **Step 1: Write the failing reducer test**

Append to `tests/unit/muster-sweep.test.ts`:

```ts
describe("markMoved", () => {
  it("turns an other-team entry into an added one", () => {
    const s = recordScan(
      EMPTY_SWEEP,
      classifyScan(ctx({ todayTeamByWorker: new Map([["w1", OTHER]]) }), "w1"),
      1_000,
    );
    expect(s.addedIds).toEqual([]);
    const m = markMoved(s, "w1");
    expect(m.entries[0]?.outcome).toBe("added");
    expect(m.entries[0]?.detail).toBeNull();
    expect(m.addedIds).toEqual(["w1"]);
  });

  it("is a no-op for a worker with no entry", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(markMoved(s, "w9")).toEqual(s);
  });

  it("does not double-add a worker already counted", () => {
    const s = recordScan(EMPTY_SWEEP, classifyScan(ctx(), "w1"), 1_000);
    expect(markMoved(s, "w1").addedIds).toEqual(["w1"]);
  });
});
```

Add `markMoved` to the file's import list.

- [ ] **Step 2: Run and verify it fails**

```bash
pnpm test tests/unit/muster-sweep.test.ts
```

Expected: FAIL — `markMoved is not a function`.

- [ ] **Step 3: Implement `markMoved` in `src/lib/muster/sweep.ts`**

```ts
// Spec 359 U1 — the SA moved an other-team worker onto this team after the
// sweep. The entry becomes a plain add so the count and the copy agree.
export function markMoved(state: SweepState, workerId: string): SweepState {
  const idx = state.entries.findIndex((e) => e.workerId === workerId);
  if (idx === -1) return state;
  return {
    ...state,
    entries: state.entries.map((e, i) =>
      i === idx ? { ...e, outcome: "added" as const, detail: null } : e,
    ),
    addedIds: state.addedIds.includes(workerId) ? state.addedIds : [...state.addedIds, workerId],
  };
}
```

- [ ] **Step 4: Run and verify it passes**

```bash
pnpm test tests/unit/muster-sweep.test.ts
```

- [ ] **Step 5: Write the failing UI test**

Append to `tests/unit/muster-cockpit.test.tsx`, inside the sweep describe:

```tsx
it("offers ย้ายมาทีมนี้ on an other-team row and moves on tap", async () => {
  moveMusterWorker.mockResolvedValue({ ok: true, id: "row-1" });
  // W2 is mustered on ANOTHER team today.
  renderSweep({
    ...BOARD,
    teams: [
      ...BOARD.teams,
      {
        id: "ffffffff-6666-6666-6666-666666666666",
        leadWorkerId: W3,
        leadName: "ก้อง",
        members: [
          {
            workerId: W2,
            name: "สมชาย",
            gender: null,
            inAt: "2026-07-26T01:00:00Z",
            outAt: null,
            outAuto: false,
            ot: null,
          },
        ],
        wpIds: [],
        prefillWpIds: [],
        missing: [],
      },
    ],
  });
  await openSheet();
  await scan(W2);
  expect(musterScan).not.toHaveBeenCalled();
  await act(async () => {
    await userEvent.click(screen.getByText("ย้ายมาทีมนี้"));
  });
  expect(moveMusterWorker).toHaveBeenCalledWith(
    expect.objectContaining({ workerId: W2, toTeamId: T1, date: "2026-07-26" }),
  );
  expect(screen.getByTestId("sweep-count").textContent).toContain("1");
});

it("offers no move button on an added row", async () => {
  renderSweep();
  await openSheet();
  await scan(W2);
  expect(screen.queryByText("ย้ายมาทีมนี้")).not.toBeInTheDocument();
});
```

Add `moveMusterWorker` to the file's `@/lib/muster/actions` mock:

```tsx
const moveMusterWorker = vi.fn();
```

and inside the factory: `moveMusterWorker: (...a: unknown[]) => moveMusterWorker(...a),`

- [ ] **Step 6: Run and verify it fails**

```bash
pnpm exec vitest run tests/unit/muster-cockpit.test.tsx -t "ย้ายมาทีมนี้"
```

Expected: FAIL — no such button.

- [ ] **Step 7: Implement the UI**

In `muster-add-sheet.tsx`, add `onMoveHere: (workerId: string) => void;` to the props, and render the
button inside the tally `<li>` after the note span:

```tsx
{
  e.outcome === "other_team" ? (
    <button
      type="button"
      onClick={() => onMoveHere(e.workerId)}
      disabled={pending}
      className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
    >
      ย้ายมาทีมนี้
    </button>
  ) : null;
}
```

In `muster-cockpit.tsx`, import `moveMusterWorker` alongside the other actions and add the handler
next to `onSweepDetected`:

```tsx
// Spec 359 U1 — resolve an other-team row from the tally, after the sweep.
// move_muster_worker owns every guard (same date, same project, attendance
// exists) and audits crew_change/muster_move.
const onMoveHere = (teamId: string, workerId: string) => {
  startTransition(async () => {
    const res = await moveMusterWorker({ workerId, date, toTeamId: teamId, revalidate });
    if (res.ok) {
      setSweep((s) => markMoved(s, workerId));
      playScanCue("added");
    } else {
      setSweep((s) => markFailed(s, workerId, res.error));
      playScanCue("failed");
    }
  });
};
```

and pass `onMoveHere={(workerId) => onMoveHere(sheetTeam.id, workerId)}` to `MusterAddSheet`. Add
`markMoved` to the sweep import.

- [ ] **Step 8: Run and verify it passes, then full gates**

```bash
pnpm test tests/unit/muster-sweep.test.ts tests/unit/muster-cockpit.test.tsx
```

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- [ ] **Step 9: Mutation-check**

Change `e.outcome === "other_team"` to `true` → "offers no move button on an added row" must fail.
Restore by hand; confirm with `git status --porcelain`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/muster/sweep.ts src/components/features/muster/muster-add-sheet.tsx src/components/features/muster/muster-cockpit.tsx tests/unit/muster-sweep.test.ts tests/unit/muster-cockpit.test.tsx
git commit -m "feat(muster): resolve an other-team scan with ย้ายมาทีมนี้ (spec 359 U1)"
```

- [ ] **Step 11: Real-flow verification, then ship U1**

Drive the sheet in a browser per Task 5 Step 7 (that gate covers the whole of U1, so run it here
rather than twice), then:

```bash
bash scripts/ship-pr.sh "feat(muster): continuous QR sweep (spec 359 U1)"
```

---

### Task 7: U2 — camera-first default

**Ship only after U1 has been live for several mornings and `in_method` has moved.** If the QR share
has not moved, U2 makes the SA's only working path harder for nothing — stop and re-plan instead.

Check before starting:

```bash
pnpm exec supabase db query --linked "select work_date::text||' qr='||count(*) filter (where in_method='qr')||'/'||count(*) as r from muster_attendance where session='regular' group by work_date order by work_date desc limit 7"
```

**Files:**

- Modify: `src/components/features/muster/muster-add-sheet.tsx`
- Test: `tests/unit/muster-cockpit.test.tsx`

**Interfaces:**

- Consumes: the `MusterAddSheet` props from Task 4, unchanged. No new props.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```tsx
describe("MusterAddSheet — camera-first (spec 359 U2)", () => {
  it("collapses the tap list behind a disclosure when a camera is available", () => {
    render(
      <MusterAddSheet {...base} hasCamera addable={[{ id: "w1", name: "ก", gender: null }]} />,
    );
    expect(screen.queryByText("ก")).not.toBeInTheDocument();
    expect(screen.getByText("ไม่มีบัตร / หาไม่เจอ")).toBeInTheDocument();
  });

  it("reveals the tap list when the disclosure is opened", async () => {
    render(
      <MusterAddSheet {...base} hasCamera addable={[{ id: "w1", name: "ก", gender: null }]} />,
    );
    await userEvent.click(screen.getByText("ไม่มีบัตร / หาไม่เจอ"));
    expect(screen.getByText("ก")).toBeInTheDocument();
  });

  it("leaves the tap list open when there is no camera", () => {
    render(
      <MusterAddSheet
        {...base}
        hasCamera={false}
        addable={[{ id: "w1", name: "ก", gender: null }]}
      />,
    );
    expect(screen.getByText("ก")).toBeInTheDocument();
    expect(screen.queryByText("ไม่มีบัตร / หาไม่เจอ")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
pnpm exec vitest run tests/unit/muster-cockpit.test.tsx -t "camera-first"
```

Expected: FAIL — the tap list renders unconditionally, so `ก` is present.

- [ ] **Step 3: Write the implementation**

Wrap the existing `{showTapAdd ? (…) : null}` block. Keep its contents byte-identical; only the
wrapper changes:

```tsx
{
  showTapAdd ? (
    hasCamera ? (
      // Spec 359 U2 — camera-first. The tap list is the lost-badge /
      // phoneless / no-camera safety net (spec 357 U-D's signal-removal
      // rule) so it stays ONE tap away and keeps its stays-open behaviour;
      // it just stops being the thing the SA sees first. <details> keeps
      // this zero-JS and needs no state.
      <details className="bg-card rounded-card p-3">
        <summary className="text-ink-secondary text-meta min-h-11 font-semibold">
          ไม่มีบัตร / หาไม่เจอ
        </summary>
        <div className="pt-2">{tapAddList}</div>
      </details>
    ) : (
      tapAddList
    )
  ) : null;
}
```

Extract the current tap-add markup into a `tapAddList` const above the `return` so both arms render
the identical list:

```tsx
const tapAddList = (
  <div className="flex flex-col gap-2">
    <p className="text-ink-secondary text-meta font-semibold">แตะชื่อเพื่อเพิ่มเข้าทีม</p>
    <div className="flex flex-wrap gap-2">
      {addable.length ? (
        addable.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onTapAdd(w.id)}
            disabled={pending}
            className="bg-sunk text-ink flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm disabled:opacity-50"
          >
            {w.name}
            {genderChip(w.gender)}
          </button>
        ))
      ) : (
        <span className="text-ink-muted text-meta">ช่างทุกคนเข้าทีมแล้ว</span>
      )}
    </div>
  </div>
);
```

Note the no-camera arm loses the old `bg-card rounded-card p-3` wrapper, which now lives on the
`<details>`; add `bg-card rounded-card p-3` to the `tapAddList` root div's className in the
no-camera arm by wrapping it there instead — keep the two arms visually identical to today.

- [ ] **Step 4: Run and verify it passes**

```bash
pnpm test tests/unit/muster-cockpit.test.tsx
```

- [ ] **Step 5: Full gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- [ ] **Step 6: Commit and ship**

```bash
git add src/components/features/muster/muster-add-sheet.tsx tests/unit/muster-cockpit.test.tsx
git commit -m "feat(muster): camera-first add sheet, tap list behind a disclosure (spec 359 U2)"
```

```bash
bash scripts/ship-pr.sh "feat(muster): camera-first add sheet (spec 359 U2)"
```

---

## Post-ship

- **Watch the metric.** For a week after U1:

```bash
pnpm exec supabase db query --linked "select work_date::text||' qr='||count(*) filter (where in_method='qr')||'/'||count(*) as r from muster_attendance where session='regular' group by work_date order by work_date desc limit 7"
```

Baseline is 1-in-36. If the share does not move after U1, the decode loop is the problem, not the
sheet — do not ship U2; re-plan.

- **The on-device validation morning** (spec §Sequencing) is owed before U2: the jsQR fallback's
  only production evidence is a single scan whose device was never recorded.
- Update `docs/progress-tracker.md` per the repo's feature workflow.
