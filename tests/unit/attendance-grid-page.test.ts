// Spec 400 U1 — the PAGE-level wiring the component tests are structurally
// blind to. `/team/attendance/page.tsx` is a Server Component: the view toggle,
// which client reads the holidays, and where a worker name actually points all
// live here, and spec 397 U3 shipped two dead banners for exactly this reason
// ("7,103 green tests could not see it: every test rendered the CHILD").
//
// Source scan, comments STRIPPED first — a comment quoting the very string an
// assertion looks for satisfies that assertion, which is how a guard ends up
// pinning its own documentation (spec 313 U2b).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_AUDIT_ROLES,
  MUSTER_CORRECT_ROLES,
  WORKER_ROSTER_ROLES,
} from "@/lib/auth/role-home";
import { ADD_ERROR_COPY } from "@/lib/muster/outcome-copy";

const PAGE = join(process.cwd(), "src/app/team/attendance/page.tsx");

/** JSX block comments + whole-line `//`, the two shapes this file uses. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const code = stripComments(readFileSync(PAGE, "utf8"));
const occurrences = (needle: string) => code.split(needle).length - 1;

describe("/team/attendance page — spec 400 U1 wiring", () => {
  it("renders the grid view, not merely imports it", () => {
    // >=2 is a FLOOR that only bites a symbol used once; the real count here is
    // the import plus the single render site.
    expect(occurrences("AttendanceGridView")).toBe(2);
    expect(occurrences("buildAttendanceGrid")).toBeGreaterThanOrEqual(2);
  });

  it("resolves the shape through attendanceView and branches BOTH ways on it", () => {
    expect(occurrences("attendanceView")).toBe(2);
    expect(code).toContain('shape === "grid"');
    expect(code).toContain('shape === "list"');
  });

  it("guards each view's RENDER SITE with its own arm of the shape", () => {
    // A bare toContain on the predicate is NOT this assertion: `shape === "grid"`
    // also appears in the two data-loading guards, so replacing the render site's
    // condition with `false` left the whole grid unrendered and every test green
    // (mutation-proved). What matters is the guard IMMEDIATELY around each site.
    const near = (needle: string) => {
      const at = code.indexOf(needle);
      expect(at).toBeGreaterThan(-1);
      return code.slice(Math.max(0, at - 200), at);
    };
    expect(near("<AttendanceGridView")).toContain('shape === "grid" && (');
    expect(near('<ul className="flex flex-col gap-2">')).toContain('shape === "list" && (');
  });

  it("keeps the list reachable — the grid is a default, not a replacement", () => {
    // Spec §D7: the list is the better read for one person's month and it is
    // what the CSV mirrors. A toggle that only points one way would retire it.
    expect(code).toContain('["grid", "list"] as const');
    expect(occurrences("viewHref")).toBeGreaterThanOrEqual(2);
  });

  it("carries the view through the range form, so a list reader stays in the list", () => {
    expect(code).toContain('<input type="hidden" name="view" value="list" />');
  });

  it("keeps the drill's own links in the list view", () => {
    // Without this the drill's open/close links drop ?view and bounce the reader
    // to the grid, where the drill they just asked for does not exist.
    const drill = code.slice(
      code.indexOf("const drillHref"),
      code.indexOf("return (", code.indexOf("const drillHref")),
    );
    expect(drill).toContain('q.set("view", "list")');
  });

  it("resolves the worker link through gridWorkerHref, keyed on the REAL role set", () => {
    // The BEHAVIOUR of both arms is pinned in attendance-grid.test.ts, because a
    // source scan cannot see reachability: with the branch inline, mutating
    // `if (canOpenCalendar)` to `if (true)` left the fallback code and the
    // role-set count untouched and this file stayed GREEN. All this may assert
    // is that the page hands the helper the right input.
    expect(occurrences("gridWorkerHref")).toBe(2);
    expect(code).toContain("WORKER_ROSTER_ROLES.includes(ctx.role)");
    expect(code).toContain(
      "gridWorkerHref({ workerId, canOpenCalendar: inWorkerRosterRoles, range, backHref })",
    );
    // …and that the page does not quietly rebuild either destination itself.
    expect(code).not.toContain("/workers/${workerId}/attendance");
  });

  it("reads public_holidays on the SESSION client, never the admin one", () => {
    // `public_holidays` RLS is `readable by authenticated` (qual true, verified
    // live), so the admin seam would be an unjustified bypass — and this page
    // already keeps admin to the project picker alone.
    expect(code).toMatch(/supabase\s*\n?\s*\.from\("public_holidays"\)/);
    const holidayCall = code.slice(
      code.indexOf('"public_holidays"') - 400,
      code.indexOf('"public_holidays"'),
    );
    expect(holidayCall).not.toContain("createAdminClient");
  });

  it("skips the detail fetch entirely when the range is too wide to draw", () => {
    // Otherwise a ?start=2020-01-01 pulls every session ever recorded and then
    // refuses to render them. Asserting only that `gridProbe.tooWide` APPEARS is
    // the two-appearance hole again (it guards the holidays read as well), so
    // the guard is pinned adjacent to the detail call itself.
    expect(code).toContain('const drawsGrid = shape === "grid" && !gridProbe.tooWide;');
    expect(code).toContain(
      "const gridDetail = drawsGrid ? await loadAttendanceDetail(supabase, range, null) : [];",
    );
    expect(code).toContain("const { data: holidays } = drawsGrid");
  });

  it("reads the roster on the SESSION client, gated on the roles RLS actually admits", () => {
    // U2. The gate is load-bearing and the NEXT test explains why this exact set.
    expect(code).toContain("drawsGrid && inWorkerRosterRoles ? await rosterQuery");
    expect(code).toContain('supabase.from("workers").select("id, name").eq("active", true)');
    const rosterBlock = code.slice(code.indexOf("const rosterQuery"), code.indexOf("const grid ="));
    expect(rosterBlock).not.toContain("createAdminClient");
    // `day_rate` and `employee_id` are column-WALLED on `workers`; naming them
    // reads back null under RLS rather than failing, so they stay unnamed.
    expect(rosterBlock).not.toContain("day_rate");
    expect(rosterBlock).not.toContain("employee_id");
  });

  it("pins the role set the roster read depends on — a SESSION read needs RLS to agree", () => {
    // THE load-bearing assertion of U2, and the one that will age.
    //
    // Live `workers` policy "readable by staff" (verified 2026-08-06):
    //   {site_admin, project_manager, procurement, procurement_manager,
    //    super_admin, project_director}
    // WORKER_ROSTER_ROLES is exactly ATTENDANCE_AUDIT_ROLES ∩ that policy, which
    // is why the roster can be read on the SESSION client with no admin seam.
    //
    // But the two sets MEAN different things — "who onboards ช่าง" vs "who may
    // read worker rows" — so the equality is a coincidence, not a guarantee.
    // `project_coordinator` is the live example of the hazard: it is in
    // ATTENDANCE_AUDIT_ROLES and can open `/workers` (that page reads via the
    // ADMIN client), but the policy denies it — so adding it here would give
    // this surface a SILENT EMPTY roster, never a refusal.
    //
    // If this test reds, do not "fix" it by editing the array: re-read the live
    // policy and decide whether the new member can actually SELECT `workers`.
    expect([...WORKER_ROSTER_ROLES].sort()).toEqual([
      "procurement",
      "procurement_manager",
      "project_director",
      "project_manager",
      "super_admin",
    ]);
    // …and every one of them really is an audit role, or the branch is dead.
    for (const role of WORKER_ROSTER_ROLES) {
      expect(ATTENDANCE_AUDIT_ROLES).toContain(role);
    }
  });

  it("scopes the roster to the SAME projects the attendance is scoped to", () => {
    // 🔴 found in review. The `workers` policy is ROLE-only — no project
    // predicate — while the RPCs scope `project_manager` by can_see_project, and
    // project_manager is the one WORKER_ROSTER_ROLES member outside
    // ATTENDANCE_AUDIT_ALL_PROJECT_ROLES. Unscoped, a PM gets a roster of every
    // active worker in the firm against their own projects' attendance: every
    // other project's workers rendered "never scanned", and counted into the
    // absent line. A finding-shaped lie.
    const block = code.slice(code.indexOf("const rosterProjectIds"), code.indexOf("const grid ="));
    expect(block).toContain("range.projectId\n    ? [range.projectId]");
    expect(block).toContain("seesAllProjects");
    expect(block).toContain("(projectOptions ?? []).map((p) => p.id)");
    expect(block).toContain('rosterBase.in("project_id", rosterProjectIds)');
  });

  it("asks for ACTIVE workers on every arm of the roster query", () => {
    // The earlier version of this test asserted `.eq("active", true)` against
    // one branch only, so deleting it from the other stayed green while inactive
    // workers gained roster rows. One base query now carries it, and the pin is
    // that the project filter is applied TO that base rather than beside it.
    const block = code.slice(
      code.indexOf("const rosterBase"),
      code.indexOf("const { data: roster"),
    );
    expect(block).toContain('.eq("active", true)');
    expect(occurrences('.from("workers")')).toBe(1);
  });

  it("throws on a roster read error instead of reporting nobody absent", () => {
    // A swallowed error reverts the grid to U1 silently AND makes absentCount 0
    // — "the roster could not be read" rendered as "nobody is absent". Mirrors
    // loadAttendanceSummary, which throws for the same reason.
    expect(code).toContain("error: rosterError");
    expect(code).toContain("if (rosterError) throw new Error(");
  });

  it("lets the GRID speak when nobody was scanned at all", () => {
    // The maximal instance of the finding: a range with no muster whatsoever.
    // Gating on the attendance summary alone fetched the roster and threw it
    // away. The list keeps the summary gate — it draws no roster rows.
    expect(code).toContain('{(shape === "grid" ? grid.rows.length === 0 : rows.length === 0) ? (');
  });

  it("stops calling the CSV ทุกคน on a view where it is not everyone", () => {
    // The file is built from attendance sessions, so a roster-only worker has
    // nothing in it — 42 rows on screen, 25 in the download.
    expect(code).toContain(
      'shape === "grid" ? "ดาวน์โหลด CSV (ผู้ที่มีบันทึก)" : "ดาวน์โหลด CSV (ทุกคน)"',
    );
  });

  it("states the absent count beside the header number it would otherwise contradict", () => {
    // Live: the header reads `25 คน` (people the muster recorded) above a table
    // of 42 rows once the roster is unioned in. One screen, two numbers, no
    // explanation — so the finding is written out, and derived from the GRID the
    // reader is looking at rather than recomputed from another source.
    expect(code).toContain(
      'const absentCount = shape === "grid" ? grid.rows.filter((r) => r.daysPresent === 0).length : 0;',
    );
    expect(code).toContain("ไม่มีบันทึกการเช็คชื่อในช่วงนี้ {absentCount} คน");
    // It sits in the header card, not in the grid — a per-range fact, once.
    const header = code.slice(
      code.indexOf("{rows.length} คน"),
      code.indexOf("<AttendanceGridView"),
    );
    expect(header).toContain("absentCount > 0");
  });

  it("hands the roster to the builder as a UNION input, not as the row set", () => {
    // Measured: one worker with attendance in the live window is not `active`.
    // Substituting the roster for the rows would drop them from a grid that
    // already shows them.
    const gridCall = code.slice(code.indexOf("const grid = buildAttendanceGrid"));
    expect(gridCall).toContain("rows: gridDetail");
    expect(gridCall).toContain("roster: roster ?? []");
  });

  it("pays for the per-worker drill query only in the view that renders it", () => {
    const drill = code.slice(code.indexOf("const detailDays"), code.indexOf("const exportHref"));
    expect(drill).toContain('shape === "list"');
  });
});

describe("/team/attendance page — spec 400 U3b wiring", () => {
  it("keys canClose on close_muster_day's OWN allowlist, never on SA_SURFACE_ROLES", () => {
    // THE defect this unit exists for. SA_SURFACE_ROLES was a correct mirror of
    // that RPC until migration 20260813075912 added `procurement`; keeping it
    // left two sentences telling the one role this work is for to hand the close
    // to the SA. Absence is pinned BARE, not quote-wrapped: a revert would write
    // the identifier, not a string literal.
    expect(code).toContain("const canClose = MUSTER_CLOSE_ROLES.includes(ctx.role);");
    expect(code).not.toContain("SA_SURFACE_ROLES");
    expect(occurrences("MUSTER_CLOSE_ROLES")).toBe(2);
  });

  it("renders the day panel, not merely imports it", () => {
    expect(occurrences("AttendanceDayPanel")).toBe(2);
    expect(occurrences("attendanceDayParam")).toBe(2);
  });

  it("validates ?day= against the dates the grid actually DREW", () => {
    // Mirrors ?worker=. Passing the raw param would render a panel about a column
    // that is not on screen, and a malformed one would reach the RPC as a date
    // parse error on the error boundary.
    const block = code.slice(
      code.indexOf("const openDayDate"),
      code.indexOf("const canCorrectDay"),
    );
    expect(block).toContain("grid.days.map((d) => d.date)");
  });

  it("gives the panel the PICKED project, so a ทุกโครงการ column cannot guess one", () => {
    // close_muster_day and reopen_muster_day each take one p_project; the panel's
    // noProject arm is what makes that visible instead of submitting a wrong one.
    const panel = code.slice(code.indexOf("<AttendanceDayPanel"), code.indexOf("</>"));
    expect(panel).toContain("projectId={range.projectId ?? null}");
    expect(panel).toContain("canReopen={canReopen}");
    expect(panel).toContain("canClose={canClose}");
  });

  it("withholds the column LINK from roles that may neither close nor reopen", () => {
    // Not a withheld fact: the panel would carry only the closure and headcount
    // the column header already prints, under a link promising a refused action.
    expect(code).toContain("const canCorrectDay = canReopen || canClose;");
    const site = code.slice(code.indexOf("<AttendanceGridView"), code.indexOf("{openDay !== null"));
    expect(site).toContain("canCorrectDay ?");
    expect(site).toContain(": null");
  });

  it("renders the panel only when a VALID day resolved", () => {
    // `openDay` is the found GridDay, not the raw param — so an unparseable or
    // out-of-range ?day= renders nothing rather than a panel about nothing.
    expect(code).toContain("{openDay !== null && (");
    expect(code).toContain(
      "const openDay = grid.days.find((d) => d.date === openDayDate) ?? null;",
    );
  });

  it("owns the close outcome copy here, and reads the code from the QUERY", () => {
    // The action returns a CODE; a Thai sentence in a URL is unbounded, survives
    // in history and would render attacker-chosen text inside the app's own
    // notice. Same rule the reopen banners already follow.
    expect(code).toContain("CLOSE_ERROR_COPY");
    expect(code).toContain('closed === "1"');
    // …and no arm of it may promise a retry: every one of them is permanent.
    const copy = code.slice(code.indexOf("const CLOSE_ERROR_COPY"), code.indexOf("interface"));
    expect(copy).not.toContain("ลองใหม่");
  });

  it("hands the outcome to the PANEL, and keeps a header fallback for a dead ?day=", () => {
    // The redirect anchors on `#d-<date>`, and the panel sits below a 42-row
    // table — a banner in the page header lands a viewport away from the reader,
    // so a refusal reads as nothing having happened. But a `?day=` that no
    // longer resolves leaves no panel, and rendering nowhere would turn that
    // refusal into silence, so the header keeps the other arm.
    expect(code).toContain("outcome={closeOutcome}");
    expect(code).toContain("{closeOutcome !== null && openDay === null && (");
  });

  it("discloses what closing COSTS, from the rows already on screen", () => {
    // close_muster_day stamps 17:00 on every open REGULAR session and leaves the
    // open OT ones alone. Derived from gridDetail — a second fetch would let the
    // disclosure and the table disagree about the same day.
    expect(code).toContain("const openDaySessions = openDay");
    expect(code).toContain("stillIn={stillInOnOpenDay}");
    const block = code.slice(
      code.indexOf("const stillInOnOpenDay"),
      code.indexOf("const closeOutcome"),
    );
    expect(block).toContain('r.stillIn && r.session === "regular"');
    expect(block).toContain('r.stillIn && r.session === "ot"');
  });
});

describe("/team/attendance page — spec 400 U5 wiring (the correction trail)", () => {
  it("reads the trail and hands it to the panel", () => {
    // The import plus the single call site; the panel prop is what makes the
    // fetch visible to a reader. A component test cannot see any of this — the
    // whole fetch lives in the Server Component.
    expect(occurrences("loadDayAudit")).toBe(2);
    expect(code).toContain("trail={dayTrail}");
  });

  it("reads it on the SESSION client, not the admin one", () => {
    // The RPC is SECURITY DEFINER and gates on ATTENDANCE_AUDIT_ROLES itself, so
    // the admin client would move a live authorization decision into TS where no
    // pgTAP can drive it over the role domain.
    expect(code).toContain("loadDayAudit(supabase,");
  });

  it("passes NULL rather than an empty trail when no project is picked", () => {
    // `list_muster_day_audit` takes exactly one project, so a ทุกโครงการ column is
    // never read — and `[]` would render "ยังไม่มีการแก้ไขย้อนหลัง" about a day the
    // page did not look at. The guard is on the PROJECT, not only on the column.
    const block = code.slice(code.indexOf("const dayTrail"), code.indexOf("const dayHref"));
    expect(block).toContain("openDay !== null && range.projectId");
    expect(block).toContain(": null");
  });
});

// Writing failing test first.
//
// Spec 400 U3c-b — the add-person wiring. The component test renders the FORM;
// only a page-level test can see which client fetches the teams, whether the
// worker list actually excludes the people already mustered, and whether the
// outcome copy is owned here rather than carried in the URL. That gap is exactly
// what shipped two dead banners in spec 397 U3.
describe("/team/attendance page — spec 400 U3c-b wiring", () => {
  it("keys the add control on muster_correct_session's OWN allowlist", () => {
    // NOT MUSTER_CLOSE_ROLES: that set includes site_admin, whom the correction
    // RPCs deliberately exclude — reusing it would put the form in front of a
    // role whose own server refuses it.
    expect(code).toContain("const canCorrect = MUSTER_CORRECT_ROLES.includes(ctx.role);");
    expect(occurrences("MUSTER_CORRECT_ROLES")).toBe(2);
  });

  it("reads the day's teams through the DEFINER RPC, never off the table", () => {
    // muster_teams RLS is can_see_project, which is `else false` for
    // `procurement` — a PostgREST read would return an empty picker for 4 of the
    // 5 people this form exists for, with no error to notice.
    expect(code).toContain("list_muster_teams_for_day");
    expect(code).not.toContain('from("muster_teams")');
  });

  it("fetches the teams ONLY when the form could actually render", () => {
    // A day panel is open on most views; an unconditional RPC call would add a
    // round trip to every render for the roles that may not correct at all.
    const block = code.slice(code.indexOf("list_muster_teams_for_day") - 400);
    expect(block).toContain("canCorrect");
  });

  it("offers only workers who are NOT already mustered that day", () => {
    // The RPC refuses a duplicate, so an unfiltered list is an offer-then-refuse:
    // the commonest correction is one person, and the list is 41 names long.
    expect(code).toContain("addCandidates");
    const block = code.slice(
      code.indexOf("const musteredOnOpenDay"),
      code.indexOf("const addOutcome"),
    );
    // The exclusion set comes from the day's OWN sessions, and the population it
    // is subtracted from is the grid's rows — which U2 already UNIONs the roster
    // into, so a worker the muster has never recorded is exactly who is offered.
    expect(block).toContain("openDaySessions");
    expect(block).toContain("grid.rows");
    expect(block).toContain("!musteredOnOpenDay.has(r.workerId)");
  });

  it("owns the add outcome copy here and reads the CODE from the query", () => {
    expect(code).toContain("ADD_ERROR_COPY");
    expect(code).toContain("addError");
    // Spec 400 U6a moved the map itself to outcome-copy.ts (the fix page shares
    // it), so the honest-copy rule is checked there directly rather than by
    // slicing this page's source — a slice keyed on "const ADD_ERROR_COPY"
    // would find nothing here now that this file only imports it.
    expect(ADD_ERROR_COPY).not.toBe(undefined);
    for (const [key, value] of Object.entries(ADD_ERROR_COPY)) {
      expect(value, `${key} must not promise a retry`).not.toContain("ลองใหม่");
    }
  });

  it("passes the panel everything the add arm needs", () => {
    const panel = code.slice(code.indexOf("<AttendanceDayPanel"), code.indexOf("</>"));
    expect(panel).toContain("canCorrect={canCorrect}");
    expect(panel).toContain("addTeams={addTeams}");
    expect(panel).toContain("addWorkers={addCandidates}");
    expect(panel).toContain("addOutcome={addOutcome}");
  });

  // ── Spec 400 U6b — the doors into the fix screen ───────────────────────────
  //
  // Writing failing test first. These live at the PAGE because the page is where
  // the role gate and the project-resolution are decided; a component test can
  // render a linked grid all day without proving that the ROLE which gets the
  // links is the one the RPC accepts.

  it("gates the cell links on MUSTER_CORRECT_ROLES, the set the RPC accepts", () => {
    const view = code.slice(code.indexOf("<AttendanceGridView"));
    const block = view.slice(0, view.indexOf("/>"));
    expect(block).toContain("cellFixHref");
    // The gate must be the correction audience, NOT this page's own wider gate.
    // ATTENDANCE_AUDIT_ROLES includes project_manager and project_director, whom
    // muster_correct_session refuses with 42501.
    expect(block).toMatch(/cellFixHref=\{canCorrect \?/);
    expect(block).not.toContain("cellFixHref={canCorrectDay");
  });

  it("only offers GAP links when a project is actually picked", () => {
    // With no session there is nothing for the fix page to infer a project from,
    // so a gap link without one lands on a page that offers a sentence.
    const view = code.slice(code.indexOf("<AttendanceGridView"));
    const block = view.slice(0, view.indexOf("/>"));
    expect(block).toMatch(/canFixGaps=\{[^}]*range\.projectId/);
  });

  it("builds the fix href through fixHref, not a hand-rolled query string", () => {
    // One builder, shared with the panel and the calendar: three copies of
    // `new URLSearchParams` in three files is how a param contract drifts.
    expect(occurrences("fixHref")).toBeGreaterThanOrEqual(2);
  });

  it("threads the reader's own URL as the fix screen's back referrer", () => {
    const slice = code.slice(code.indexOf("const cellFixHref"));
    const decl = slice.slice(0, slice.indexOf("\n  //") + 1 || 400);
    expect(decl).toContain("backHref");
  });

  it("asserts the correction audience is a strict SUBSET of this page's own gate", () => {
    // Not decoration: if a role could ever hold MUSTER_CORRECT_ROLES without
    // ATTENDANCE_AUDIT_ROLES it would be handed a link on a page it cannot open,
    // and the subset is what makes "narrower" the right word everywhere above.
    for (const role of MUSTER_CORRECT_ROLES) {
      expect(ATTENDANCE_AUDIT_ROLES, `${role} must be able to open this page`).toContain(role);
    }
    // …and genuinely narrower, or the whole gate is theatre.
    expect(MUSTER_CORRECT_ROLES.length).toBeLessThan(ATTENDANCE_AUDIT_ROLES.length);
  });
});
