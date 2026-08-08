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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceDayPanel } from "@/components/features/muster/attendance-day-panel";
import { WorkerDayFixPanel } from "@/components/features/muster/worker-day-fix-panel";
import { dayClosable } from "@/lib/muster/day-correction";
import type { WorkerDayFix } from "@/lib/muster/worker-day-fix";

const TODAY = "2026-08-08";
const PAST = "2026-08-05";
const PROJECT = "a88af871-019b-4eca-a7aa-f05244c83e5d";

function data(over: Partial<WorkerDayFix> = {}): WorkerDayFix {
  return {
    workerName: "นายอนันต์ แสงทอง",
    projectId: PROJECT,
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
    hostOffersClose?: boolean;
    close?: { ok: true } | { ok: false; message: string } | null;
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
      // ⚠️ Spread, NOT `?? false`. Passing the prop unconditionally would mean no
      // test ever exercises the DEFAULT — and the default is what both stranded
      // doors rely on, so flipping it to `true` would delete their only close
      // with the whole suite green. The bug, re-shipped, invisibly.
      {...(over.hostOffersClose === undefined ? {} : { hostOffersClose: over.hostOffersClose })}
      outcomes={{ retime: null, undo: null, add: null, reopen: null, close: over.close ?? null }}
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
    //
    // ⚠️ NOT `/ทั้งวัน|ทุกคน/`: `MUSTER_DAY_CLOSE_MEANING` — a pre-existing SSOT
    // label this form also prints — already contains ทุกคน, so that pattern was
    // satisfied with the per-worker sentence DELETED. Pin the words only the
    // sentence under test can produce.
    renderPanel();
    expect(closeForm()!.textContent).toMatch(/ไม่ใช่แค่ช่างคนนี้/);
  });

  it("is honest about OT: the 17:00 auto-out is REGULAR only, and OT is lost", () => {
    // `close_muster_day` auto-outs `and a.session = 'regular'` and leaves an open
    // OT row untouched, and no RPC can back-date a check-out — so that OT is
    // permanently unbookable. An unqualified "ช่างที่ยังไม่เช็คออกจะถูกบันทึกเวลาออก
    // 17:00 ให้" promises the opposite. The day panel always disclosed the loss;
    // this surface shipped without it until the shared form was extracted.
    renderPanel();
    const text = closeForm()!.textContent!;
    expect(text).toMatch(/เฉพาะงานปกติ/);
    expect(text).toMatch(/ไม่บันทึก OT/);
  });

  it("reports the close's own outcome — a refusal may not be silent", () => {
    // `closeMusterDayFromForm` redirects with `?closeError=…`; a door that offers
    // the control and never reads it answers a refusal with a page identical to
    // the one before the tap, and the day quietly stays open.
    renderPanel({ close: { ok: false, message: "บัญชีนี้ไม่มีสิทธิ์ปิดวันของโครงการนี้" } });
    expect(screen.getByText("บัญชีนี้ไม่มีสิทธิ์ปิดวันของโครงการนี้")).not.toBeNull();
  });

  it("reports a SUCCESSFUL close even though success withdraws the form", () => {
    // The success flips `dayClosed` to true, which removes the close card. An
    // outcome rendered inside that card could only ever show the failure — so
    // this asserts the success survives on the CLOSED-day render, where the
    // reader actually lands.
    renderPanel({ fix: { dayClosed: true }, close: { ok: true } });
    expect(closeForm()).toBeNull();
    expect(screen.getByText("ปิดวันดังกล่าวแล้ว")).not.toBeNull();
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

// ---------------------------------------------------------------------------
// The DUAL of the bug above, measured in real Chrome before it was written.
//
// `/team/attendance` docks this panel UNDER `AttendanceDayPanel`, which owns the
// day and renders its own ปิดวัน. Driven live, that page served **two** ปิดวัน
// forms — and they are not equals: the day panel's disclosure NAMES the workers
// still checked in who will be given a fabricated 17:00
// (`ช่าง N คนยังไม่เช็คออก … · ชื่อ, ชื่อ`), which this panel structurally cannot
// know because it loads ONE worker. Two doors to the same money write, the lower
// one thinner, is the "softer door" this unit's own confirm-checkbox test names.
//
// ⚠️ It is a WITHHOLDING, not a rule change: the panel keeps its close wherever
// the host has none — which is every other door, and also `/team/attendance`
// itself under ทุกโครงการ, where the day panel resolves `noProject` and shows no
// control at all. So the caller passes its host's OWN answer, from the same
// `dayClosable`, rather than a hardcoded `true`.
//
// ⓘ REOPEN doubles up on that page today and is left alone — pre-existing since
// spec 400 U7, untouched by this branch, and recorded as its own follow-up.
// ---------------------------------------------------------------------------

describe("no TWO ปิดวัน on one screen", () => {
  it("withholds its close when the host surface already renders one", () => {
    renderPanel({ hostOffersClose: true });
    expect(closeForm()).toBeNull();
  });

  it("keeps its close when the host renders none — every other door", () => {
    renderPanel({ hostOffersClose: false });
    expect(closeForm()).not.toBeNull();
  });

  it("DEFAULTS to keeping it — a door that forgets the prop cannot strand a day", () => {
    // The two doors this unit exists for pass nothing. If the default ever flips,
    // this is what reds.
    renderPanel();
    expect(closeForm()).not.toBeNull();
  });

  // The branch's actual claim, which until now lived only in the Chrome run: put
  // the two components on ONE screen over the SAME day and count the forms.
  it("renders exactly ONE ปิดวัน when both components are on the screen", () => {
    const shared = { date: PAST, todayIso: TODAY, canClose: true, projectId: PROJECT };
    const hostOffersClose = dayClosable({ ...shared, dayClosed: false });

    render(
      <>
        <AttendanceDayPanel
          day={{
            date: shared.date,
            dayClosed: false,
            headcount: 1,
            nonWorking: false,
            holidayName: null,
          }}
          todayIso={TODAY}
          projectId={PROJECT}
          canReopen
          canClose
          returnTo="/team/attendance?day=2026-08-05"
          stillIn={{ regular: [], ot: [] }}
          outcome={null}
          trail={[]}
        />
        <WorkerDayFixPanel
          data={data()}
          workerId="w1"
          date={PAST}
          todayIso={TODAY}
          returnTo="/team/attendance?day=2026-08-05&fix=w1"
          canClose
          hostOffersClose={hostOffersClose}
          outcomes={{ retime: null, undo: null, add: null, reopen: null, close: null }}
        />
      </>,
    );

    expect(screen.getAllByRole("form", { name: /^ปิดวัน/ })).toHaveLength(1);
  });
});

// PAGE-level wiring, which no component test can see: the page is a Server
// Component, and whether it hands the panel its host's real answer lives there.
// Comments stripped first — a comment quoting the symbol satisfies the scan.
describe("/team/attendance hands the panel its OWN close decision", () => {
  const code = readFileSync(join(process.cwd(), "src/app/team/attendance/page.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const uses = (needle: string) => code.split(needle).length - 1;

  it("computes the host's answer from the SHARED rule, not a hardcoded true", () => {
    // Import + the one call site. A literal `hostOffersClose` would pass a
    // presence-only pin, so the absence of `hostOffersClose={true}` is pinned too.
    expect(uses("dayClosable")).toBe(2);
    expect(uses("hostOffersClose")).toBe(1);
    expect(code).not.toContain("hostOffersClose={true}");
  });

  it("feeds it the same day the day panel is answering about", () => {
    // Wrong inputs make the withholding fire on a day whose host shows nothing —
    // deleting the panel's close from a surface that has no other one.
    expect(code).toMatch(/dayClosable\(\{[\s\S]{0,240}?dayClosed:\s*openDay\.dayClosed/);
    expect(code).toMatch(
      /dayClosable\(\{[\s\S]{0,240}?projectId:\s*range\.projectId\s*\?\?\s*null/,
    );
  });
});
