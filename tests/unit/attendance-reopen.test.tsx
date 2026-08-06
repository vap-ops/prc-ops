// Spec 397 U3 — the reopen affordance on the attendance audit report.
//
// A closed muster day is final: muster_undo_scan refuses against a closure, and
// close_muster_day books wages inline. reopen_muster_day is the way back, and
// this is the surface that offers it — on the DAY header of the drill, because
// closure is a project-day fact (the drill already prints it there).
//
// Three things are pinned:
//   1. the role set matches the RPC's allowlist exactly (a button its own server
//      refuses is the affordance-then-refuse defect this repo keeps re-learning);
//   2. the form only exists on a CLOSED day, and only for a permitted role;
//   3. the reason is REQUIRED at the input, not merely at the RPC — the RPC's
//      refusal would otherwise be the user's first hint that it is mandatory.

import { readFileSync } from "node:fs";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceDrill } from "@/components/features/muster/attendance-drill";
import {
  MUSTER_CLOSE_ROLES,
  MUSTER_REOPEN_ROLES,
  SA_SURFACE_ROLES,
  type UserRole,
} from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { groupDetailByDate, type AttendanceDetailRow } from "@/lib/muster/attendance-audit";
import { reopenReturnTo } from "@/lib/muster/reopen-return";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function row(over: Partial<AttendanceDetailRow> = {}): AttendanceDetailRow {
  return {
    workerId: "w1",
    workerName: "ช่าง หนึ่ง",
    projectId: "p1",
    projectName: "โครงการเอ",
    workDate: "2026-08-04",
    session: "regular",
    inTime: "08:22",
    outTime: "17:00",
    inMethod: "manual",
    outMethod: null,
    outAuto: false,
    otHours: null,
    stillIn: false,
    outNextDay: false,
    scannedByName: "ผู้ดูแลระบบ",
    teamLeadName: "หัวหน้า",
    dayClosed: true,
    ...over,
  } as AttendanceDetailRow;
}

const TODAY = "2026-08-05";

describe("spec 397 U3 — who may reopen", () => {
  it("is exactly the roles that may CLOSE, plus procurement", () => {
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    expect(all.filter((r) => MUSTER_REOPEN_ROLES.includes(r)).sort()).toEqual(
      ["procurement", "procurement_manager", "site_admin", "super_admin"].sort(),
    );
  });

  it("excludes the roles that only READ the report", () => {
    // accounting/hr audit attendance and must never edit the muster; a PM cannot
    // close a day either, so it cannot un-close one.
    for (const role of ["accounting", "hr", "project_manager", "project_director"] as const) {
      expect(MUSTER_REOPEN_ROLES).not.toContain(role);
    }
  });
});

describe("spec 397 U3 — the reopen form on the day header", () => {
  it("offers reopen on a CLOSED day for a permitted role", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen
        backHref="/team"
      />,
    );
    const form = screen.getByRole("form", { name: /เปิดวัน/ });
    expect(within(form).getByLabelText(/เหตุผล/)).toBeRequired();
    expect(within(form).getByRole("button", { name: /เปิดวันอีกครั้ง/ })).toBeInTheDocument();
    // The two facts the action needs, carried as hidden fields — the day header
    // is the only place that knows WHICH project-day this is.
    expect(form.querySelector('input[name="projectId"]')).toHaveValue("p1");
    expect(form.querySelector('input[name="workDate"]')).toHaveValue("2026-08-04");
  });

  it("offers nothing on an OPEN day — there is nothing to reopen", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row({ dayClosed: false })])}
        todayIso={TODAY}
        canReopen
        backHref="/team"
      />,
    );
    expect(screen.queryByRole("form", { name: /เปิดวัน/ })).not.toBeInTheDocument();
  });

  it("offers nothing to a role that may not reopen, even on a closed day", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen={false}
        backHref="/team"
      />,
    );
    expect(screen.queryByRole("form", { name: /เปิดวัน/ })).not.toBeInTheDocument();
    // …and the day still reads as closed: withholding the CONTROL must not
    // withhold the FACT.
    expect(screen.getByText(/ปิดวันแล้ว/)).toBeInTheDocument();
  });

  it("says what reopening does — it does not silently re-open a wage-relevant day", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen
        backHref="/team"
      />,
    );
    // The correction loop is reopen → fix → close again; a user who stops after
    // step 1 leaves the day underived, which is exactly the state the report
    // already flags as ยังไม่ได้ปิด.
    expect(screen.getByText(/ปิดวันใหม่/)).toBeInTheDocument();
  });
});

describe("spec 397 U3 — the redirect target (the bug the review caught)", () => {
  // The drill's own href ends `#w-<workerId>`, so appending `?reopened=1` after it
  // hid the outcome in the FRAGMENT: the page's banners were dead code and every
  // refusal — including "wages are already booked" — returned a silent no-op.
  const DRILL = "/team/attendance?start=2026-08-04&end=2026-08-04&worker=w1#w-w1";

  it("puts the outcome in the QUERY, before any fragment", () => {
    const target = reopenReturnTo(DRILL, "ok");
    const url = new URL(target, "http://x");
    expect(url.searchParams.get("reopened")).toBe("1");
    expect(url.hash).toBe("#w-w1");
    // …and the drill stays open on the same worker.
    expect(url.searchParams.get("worker")).toBe("w1");
  });

  it("carries a refusal as a CODE, never a sentence", () => {
    const url = new URL(reopenReturnTo(DRILL, "wages"), "http://x");
    expect(url.searchParams.get("reopenError")).toBe("wages");
    expect(url.hash).toBe("#w-w1");
  });

  it("refuses an off-app returnTo — including the backslash form", () => {
    // `/\evil.com` passes a naive startsWith("/") && !startsWith("//") check and
    // browsers normalise it to protocol-relative. safeBackHref rejects it.
    for (const bad of ["/\\evil.com", "//evil.com", "https://evil.com", "javascript:alert(1)"]) {
      expect(reopenReturnTo(bad, "ok")).toBe("/team/attendance?reopened=1");
    }
    expect(reopenReturnTo(undefined, "ok")).toBe("/team/attendance?reopened=1");
  });

  it("uses ? when the referrer carries no query", () => {
    expect(reopenReturnTo("/team/attendance", "denied")).toBe(
      "/team/attendance?reopenError=denied",
    );
  });
});

describe("spec 397 U3 — the loop instruction is role-aware", () => {
  // The branch is kept because the two RPCs are two allowlists; which ARM a given
  // role lands on is decided by the page and pinned in
  // attendance-day-correction.test.tsx, not here.
  it("tells a closer to close the day again", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen
        canClose
        backHref="/team"
      />,
    );
    // ⚠️ Spec 400 U3b corrected this line. It opened "แก้ไขแล้ว…", which assumed
    // the reader corrects the check-ins between the reopen and the close —
    // nothing on any page they can open does that (both undo surfaces are
    // today-locked and SA-gated; add-person is deferred to U4). It now names
    // what re-closing actually does: re-derive from the latest data.
    expect(screen.getByText(/ปิดวันใหม่เมื่อพร้อม/)).toBeInTheDocument();
    expect(screen.queryByText(/แก้ไขแล้ว/)).toBeNull();
  });

  it("tells a non-closer to hand it to the SA", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen
        canClose={false}
        backHref="/team"
      />,
    );
    expect(screen.getByText(/แจ้ง SA ให้ปิดวันใหม่/)).toBeInTheDocument();
    expect(screen.queryByText(/ปิดวันใหม่เมื่อพร้อม/)).not.toBeInTheDocument();
  });

  it("procurement — the role this spec is about — IS a closer since spec 400 U3a", () => {
    // ⚠️ This assertion used to read `SA_SURFACE_ROLES).not.toContain("procurement")`
    // and was cited as proof the loop was two-person for that role. It stayed
    // GREEN through U3a — SA_SURFACE_ROLES never changed — while the fact it was
    // standing in for stopped being true: migration 20260813075912 widened
    // `close_muster_day` itself. A test pinned to the WRONG set cannot see a
    // widening of the right one, which is why the page now keys on the set that
    // mirrors the RPC.
    expect(MUSTER_CLOSE_ROLES).toContain("procurement");
    expect(MUSTER_REOPEN_ROLES).toContain("procurement");
    // SA_SURFACE_ROLES still means "the SA cockpit surfaces" and is unchanged by
    // this unit — named here only so the two are not confused again.
    expect(SA_SURFACE_ROLES).not.toContain("procurement");
  });
});

describe("spec 397 U3 — the day carries its project id", () => {
  it("groupDetailByDate keeps projectId, not just the name", () => {
    const [day] = groupDetailByDate([row()]);
    expect(day?.projectId).toBe("p1");
  });
});

describe("spec 397 U3 — the action", () => {
  const src = strip(readFileSync("src/app/team/attendance/actions.ts", "utf8"));

  it("gates on the same set the RPC does, by importing it — never a literal", () => {
    expect(count(src, "MUSTER_REOPEN_ROLES")).toBeGreaterThanOrEqual(2);
    expect(src).not.toContain('"procurement_manager"');
  });

  it("calls the RPC and revalidates the report", () => {
    expect(count(src, '"reopen_muster_day"')).toBe(1);
    expect(count(src, "revalidatePath")).toBeGreaterThanOrEqual(2);
  });

  it("refuses a blank reason before it reaches the database", () => {
    expect(src).toContain("trim()");
  });

  it("spec 400 U3b — closes through the same gate-then-relay shape", () => {
    // The RPC is the boundary; the action's own check exists so the surface never
    // promises what the server refuses. Pinned as the SET, never a literal, so a
    // widening lands in one place.
    expect(count(src, "MUSTER_CLOSE_ROLES")).toBeGreaterThanOrEqual(2);
    expect(count(src, '"close_muster_day"')).toBe(1);
    expect(count(src, "closeReturnTo")).toBe(2); // the import + the call
    expect(src).not.toContain("closed=1");
  });

  it("spec 400 U3b — maps 42501 to a permanent refusal, and only 42501", () => {
    // A contrasting control: the close RPC's OTHER refusals are P0001 and must
    // not be reported as a permission problem. Both arms are read out of the same
    // block so deleting either reds.
    const block = src.slice(src.indexOf("close_muster_day"), src.indexOf("closeMusterDayFromForm"));
    expect(block).toContain('if (error.code === "42501") return { ok: false, outcome: "denied" };');
    expect(block).toContain('return { ok: false, outcome: "failed" };');
    // No invented "already closed" arm — the RPC upserts and re-derives.
    expect(block).not.toContain("notclosed");
  });

  it("builds its redirect through reopenReturnTo, never by hand", () => {
    // The hand-rolled version is what shipped the fragment bug AND the weak
    // open-redirect check; both live in the tested helper now.
    expect(count(src, "reopenReturnTo")).toBe(2); // the import + the call
    expect(src).not.toContain("startsWith(");
    expect(src).not.toContain("reopened=1");
  });
});
