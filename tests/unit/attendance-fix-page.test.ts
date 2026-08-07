// Writing failing test first.
//
// Spec 400 U6a — `/team/attendance/fix` is a Server Component vitest cannot
// render; the gate, which client reads what, and whether a branch is actually
// REACHABLE all live here, exactly the class of gap spec 397 U3 shipped two
// dead banners from ("every test rendered the CHILD"). Source scan, comments
// STRIPPED first — a comment quoting the string an assertion looks for
// otherwise satisfies it with the real code deleted (spec 313 U2b).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MUSTER_CORRECT_ROLES } from "@/lib/auth/role-home";

const PAGE = join(process.cwd(), "src/app/team/attendance/fix/page.tsx");

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const code = stripComments(readFileSync(PAGE, "utf8"));
const occurrences = (needle: string) => code.split(needle).length - 1;

describe("/team/attendance/fix page — the gate", () => {
  it("gates on MUSTER_CORRECT_ROLES, not MUSTER_CLOSE_ROLES", () => {
    // muster_correct_session / muster_undo_scan's own allowlist, per the
    // capability doctrine — site_admin has the cockpit for TODAY but no door
    // to a past day anywhere in the app, and this surface must not open one.
    expect(code).toContain("requireRole(MUSTER_CORRECT_ROLES)");
    expect(MUSTER_CORRECT_ROLES.includes("site_admin")).toBe(false);
  });

  it("computes canClose (for the embedded reopen form's loop copy) off the real allowlist", () => {
    expect(code).toContain("MUSTER_CLOSE_ROLES.includes(ctx.role)");
  });
});

describe("/team/attendance/fix page — params + identity", () => {
  it("parses the params through the pure, tested function, never inline", () => {
    expect(occurrences("parseFixParams")).toBeGreaterThanOrEqual(2);
  });

  it("renders an error notice rather than a 500 or a guess when parsing fails", () => {
    const near = code.slice(code.indexOf("parseFixParams("), code.indexOf("parseFixParams(") + 400);
    expect(near).toContain("=== null");
    expect(code).toContain("ErrorNotice");
  });

  it("resolves the back chip through safeBackHref, falling back to the report itself", () => {
    expect(occurrences("safeBackHref")).toBeGreaterThanOrEqual(2);
    expect(code).toContain('safeBackHref(sp.from, "/team/attendance")');
    expect(code).toContain("attendanceBackLabel(backHref)");
  });

  it("reads the worker's name off the SESSION client, never admin", () => {
    const block = code.slice(
      code.indexOf('.from("workers")') - 200,
      code.indexOf('.from("workers")') + 50,
    );
    expect(block).toContain("supabase");
    expect(block).not.toContain("admin.from");
  });

  // Gate-4 real-flow finding (2026-08-07): a no-session worker-day with ?project=
  // rendered the date with NO project name, because projectName only ever came
  // off `sessions[0]` — a real gap against the header's own precedent (every
  // session-bearing render shows "date · project"). Fixed with a SESSION-client
  // lookup (projects RLS already includes procurement/procurement_manager —
  // verified live and documented on the day-panel page), only when there is no
  // session to read it from.
  it("falls back to a projects lookup for the header when there is no session", () => {
    expect(code).toContain('.from("projects")');
    const block = code.slice(
      code.indexOf('.from("projects")') - 200,
      code.indexOf('.from("projects")') + 200,
    );
    expect(block).toContain("sessions.length === 0");
    expect(block).not.toContain("admin.from");
  });
});

describe("/team/attendance/fix page — sessions, closure and team resolution", () => {
  it("reads the worker-day's sessions through loadAttendanceDetail", () => {
    expect(occurrences("loadAttendanceDetail")).toBeGreaterThanOrEqual(2);
  });

  it("derives closure from the sessions when any exist, an ADMIN lookup otherwise", () => {
    expect(code).toContain("sessions.every((s) => s.dayClosed)");
    expect(code).toContain('.from("muster_day_closures")');
    const block = code.slice(
      code.indexOf('.from("muster_day_closures")') - 50,
      code.indexOf('.from("muster_day_closures")') + 300,
    );
    expect(block).toContain("admin");
  });

  it("only resolves closure via the admin lookup when a project is actually known", () => {
    // A no-session worker-day with NO ?project= must leave dayClosed at `null`
    // (the "pick a project first" state) rather than guessing — the admin
    // lookup needs a project id to scope to, and calling it unconditionally
    // would either crash on a null id or, worse, silently read the WRONG
    // project-day if a bug ever supplied a stale default.
    const block = code.slice(
      code.indexOf('.from("muster_day_closures")') - 200,
      code.indexOf('.from("muster_day_closures")'),
    );
    expect(block).toContain("projectId !== null");
  });

  it("resolves the retime team id through an ADMIN lookup, not a session-client read", () => {
    // muster_attendance / muster_teams RLS is can_see_project — FALSE for
    // procurement — so the session client cannot answer this for the audience
    // this page exists for.
    expect(code).toContain('.from("muster_attendance")');
    const block = code.slice(
      code.indexOf('.from("muster_attendance")') - 50,
      code.indexOf('.from("muster_attendance")') + 300,
    );
    expect(block).toContain("admin");
  });

  it("throws rather than silently degrading when the team lookup comes back empty", () => {
    const block = code.slice(
      code.indexOf('.from("muster_attendance")'),
      code.indexOf('.from("muster_attendance")') + 500,
    );
    expect(block).toContain("throw new Error");
  });
});

describe("/team/attendance/fix page — the add arm", () => {
  it("gates ADD on canAddMissingSession — only when no regular session exists yet", () => {
    expect(occurrences("canAddMissingSession")).toBeGreaterThanOrEqual(2);
  });

  it("reads the day's teams through the DEFINER RPC, never off the table", () => {
    expect(code).toContain("list_muster_teams_for_day");
    expect(code).not.toContain('from("muster_teams")');
  });

  it("decides the add control through addPersonControl, the day panel's own function", () => {
    expect(occurrences("addPersonControl")).toBeGreaterThanOrEqual(2);
  });
});

// Confirms the needle sits strictly BETWEEN a top-level guard's opener and the
// next TOP-LEVEL sibling section that follows it — the "pin the SITE" rule: a
// bare toContain/window scan cannot tell "guarded by the right block" from
// "merely preceded, somewhere upstream, by that string". `guard` is found by
// the NEAREST preceding occurrence (safe even when the same guard string is
// reused at a NESTED level elsewhere, e.g. "sessions.length > 0" also guards
// the delete list inside the dayClosed===false block — lastIndexOf from the
// needle always lands on its own innermost opener). The three `dayClosed`
// arms are each written EXACTLY ONCE at the top level, so they are safe
// SIBLING boundaries regardless of which guard opened the range.
const SIBLING_BOUNDARIES = [
  "{dayClosed === true && (",
  "{dayClosed === false && (",
  "{dayClosed === null && (",
];
function isSitedUnder(needle: string, guard: string): boolean {
  const at = code.indexOf(needle);
  expect(at).toBeGreaterThan(-1);
  const openAt = code.lastIndexOf(guard, at);
  if (openAt === -1 || openAt > at) return false;
  let nextSiblingAt = Infinity;
  for (const g of SIBLING_BOUNDARIES) {
    if (g === guard) continue; // the guard's OWN string never bounds itself
    const gi = code.indexOf(g, openAt + guard.length);
    if (gi !== -1 && gi < nextSiblingAt) nextSiblingAt = gi;
  }
  return at < nextSiblingAt;
}

describe("/team/attendance/fix page — the locked group", () => {
  it("renders the reopen form ONLY when the day is closed", () => {
    expect(isSitedUnder("<MusterReopenForm", "{dayClosed === true && (")).toBe(true);
  });

  it("states the day-wide blast radius in the locked group, not per-control", () => {
    expect(code).toContain("ทั้งวัน");
  });

  it("offers add/delete ONLY on an open day", () => {
    expect(isSitedUnder("<AttendanceFixAddForm", "{dayClosed === false && (")).toBe(true);
    expect(isSitedUnder("<AttendanceFixUndoForm", "{dayClosed === false && (")).toBe(true);
  });
});

describe("/team/attendance/fix page — retime is offered on ANY day state", () => {
  it("renders one retime card per session, gated only on sessions existing", () => {
    // …and NOT gated on dayClosed — the whole point of retime is that it works
    // on a closed day too (the unbooked-wage anti-join is the real guard).
    expect(isSitedUnder("<AttendanceFixRetimeForm", "{sessions.length > 0 && (")).toBe(true);
    expect(isSitedUnder("<AttendanceFixRetimeForm", "{dayClosed === false && (")).toBe(false);
  });

  it("computes outLocked through outTimeLocked, not inline", () => {
    expect(occurrences("outTimeLocked")).toBeGreaterThanOrEqual(2);
  });
});

describe("/team/attendance/fix page — the trail, filtered to ONE worker", () => {
  it("reads the same RPC the day panel does, then filters by workerId in TS", () => {
    expect(occurrences("loadDayAudit")).toBeGreaterThanOrEqual(2);
    const block = code.slice(code.indexOf("loadDayAudit("), code.indexOf("loadDayAudit(") + 300);
    expect(block).toContain("r.workerId === workerId");
  });

  it("passes null, not an empty array, when no project is known", () => {
    const block = code.slice(
      code.indexOf("const fullTrail"),
      code.indexOf("const fullTrail") + 200,
    );
    expect(block).toContain("projectId !== null");
    expect(block).toContain(": null");
  });
});

describe("/team/attendance/fix page — outcome copy, owned here and shared", () => {
  it("reads all four outcome maps from the shared module", () => {
    expect(code).toContain("RETIME_ERROR_COPY");
    expect(code).toContain("UNDO_ERROR_COPY");
    expect(code).toContain("ADD_ERROR_COPY");
    expect(code).toContain("REOPEN_ERROR_COPY");
    expect(code).toContain('from "@/lib/muster/outcome-copy"');
  });

  it("reads every outcome from the query as a CODE, never a raw sentence", () => {
    expect(code).toContain("sp.retimeError");
    expect(code).toContain("sp.undoError");
    expect(code).toContain("sp.addError");
    expect(code).toContain("sp.reopenError");
  });
});
