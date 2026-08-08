// The fix panel could REOPEN a day but never CLOSE it — and that stranded a
// real production day.
//
// Writing failing test first.
//
// THE INCIDENT. Procurement reopened `PRC-2026-004` `2026-08-05` and had no way
// to close it again; the day sat open with its wages underived. It was NOT a
// permission — `close_muster_day` succeeds as plain `procurement`, driven live
// in a rollback-wrapped transaction. `MusterReopenForm` renders on THREE
// surfaces (the spec-404 calendar's `?fix=` panel, `/team/attendance/fix`, and
// `/team/attendance`'s day panel) while the close control existed on ONE. The
// reopen form's own copy meanwhile instructs
// `แก้เสร็จต้องปิดวันใหม่ ค่าแรงจึงจะคิดใหม่ทั้งวัน` — an act two of those three
// surfaces could not perform. Affordance-then-instruct.
//
// ⚠️ This is also the panel's FIRST component test. It had none, which is why
// the missing control was invisible to the suite.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkerDayFixPanel } from "@/components/features/muster/worker-day-fix-panel";
import type { WorkerDayFix } from "@/lib/muster/worker-day-fix";

const TODAY = "2026-08-08";
const PAST = "2026-08-05";

function data(over: Partial<WorkerDayFix> = {}): WorkerDayFix {
  return {
    workerName: "นายอนันต์ แสงทอง",
    projectId: "a88af871-019b-4eca-a7aa-f05244c83e5d",
    projectName: "PRC-2026-004 TFM โพธิ์ทอง",
    sessions: [],
    dayClosed: false,
    teamId: "t1",
    offersAdd: false,
    addState: null,
    addTeams: [],
    trail: [],
    ...over,
  };
}

function renderPanel(
  over: {
    fix?: Partial<WorkerDayFix>;
    date?: string;
    todayIso?: string;
    canClose?: boolean;
  } = {},
) {
  return render(
    <WorkerDayFixPanel
      data={data(over.fix)}
      workerId="w1"
      date={over.date ?? PAST}
      todayIso={over.todayIso ?? TODAY}
      returnTo="/workers/w1/attendance?m=2026-08&fix=2026-08-05"
      canClose={over.canClose ?? true}
      outcomes={{ retime: null, undo: null, add: null, reopen: null }}
    />,
  );
}

const closeForm = () => screen.queryByRole("form", { name: /^ปิดวัน/ });

describe("the fix panel can close an open past day (the 2026-08-05 incident)", () => {
  it("offers ปิดวัน on an OPEN past day, so reopening is not a one-way door", () => {
    renderPanel();
    expect(closeForm()).not.toBeNull();
  });

  it("carries the three fields close_muster_day needs", () => {
    // A form that renders but posts the wrong shape is worse than no form: the
    // reader taps and the action refuses.
    renderPanel();
    const form = closeForm()!;
    for (const [name, value] of [
      ["projectId", "a88af871-019b-4eca-a7aa-f05244c83e5d"],
      ["workDate", PAST],
      ["returnTo", "/workers/w1/attendance?m=2026-08&fix=2026-08-05"],
    ]) {
      expect(form.querySelector(`input[name="${name}"]`)?.getAttribute("value")).toBe(value);
    }
  });

  it("requires a second deliberate act before the money step", () => {
    // Closing derives the whole day's wages. The day panel gates it behind a
    // required checkbox because this surface carries no client JS; the same
    // guard has to travel with the control, or the panel is the softer door to
    // the same write.
    renderPanel();
    const confirm = closeForm()!.querySelector('input[type="checkbox"][name="confirm"]');
    expect(confirm).not.toBeNull();
    expect(confirm!.hasAttribute("required")).toBe(true);
  });

  it("says the close is for the WHOLE DAY, not just this worker", () => {
    // This panel is per-WORKER and the button acts on everyone on the day. The
    // closed-day card already makes that point for reopen; the close needs it
    // more, because it is the step that books the money.
    renderPanel();
    expect(closeForm()!.textContent).toMatch(/ทั้งวัน|ทุกคน/);
  });

  it("withholds it on a CLOSED day — that day's control is เปิดวันอีกครั้ง", () => {
    renderPanel({ fix: { dayClosed: true } });
    expect(closeForm()).toBeNull();
    expect(screen.queryByRole("form", { name: /^เปิดวัน/ })).not.toBeNull();
  });

  it("withholds it on TODAY and on a day with no records", () => {
    // Closing today mid-shift fabricates the day's end; `dayClosed === null` is
    // a day with no attendance at all.
    renderPanel({ date: TODAY });
    expect(closeForm()).toBeNull();
    renderPanel({ fix: { dayClosed: null } });
    expect(closeForm()).toBeNull();
  });

  it("withholds it from a reader close_muster_day refuses, and from a projectless panel", () => {
    renderPanel({ canClose: false });
    expect(closeForm()).toBeNull();
    renderPanel({ fix: { projectId: null } });
    expect(closeForm()).toBeNull();
  });
});
