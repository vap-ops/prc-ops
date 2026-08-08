// Writing failing test first.
//
// Spec 400 U6a — retime ONE existing session. No defaults on either time field
// (a pre-filled guess is worse than an empty one forcing a real value, the same
// rule U4's add form follows), and the out-time field is disabled + explained
// once a HUMAN recorded that check-out (`outTimeLocked`).

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceFixRetimeForm } from "@/components/features/muster/attendance-fix-retime-form";

function renderForm(over: Partial<Parameters<typeof AttendanceFixRetimeForm>[0]> = {}) {
  render(
    <AttendanceFixRetimeForm
      teamId="11111111-1111-1111-1111-111111111111"
      workerId="22222222-2222-2222-2222-222222222222"
      session="regular"
      workDate="2026-08-04"
      returnTo="/team/attendance/fix?worker=x&date=2026-08-04"
      currentInAt="2026-08-04T01:00:00Z"
      currentOutAt={null}
      outLocked={false}
      {...over}
    />,
  );
  return screen.getByRole("form");
}

describe("AttendanceFixRetimeForm", () => {
  it("carries the team, worker, session and work date as hidden fields", () => {
    const form = renderForm();
    expect(form.querySelector('input[name="teamId"]')?.getAttribute("value")).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(form.querySelector('input[name="workerId"]')?.getAttribute("value")).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(form.querySelector('input[name="session"]')?.getAttribute("value")).toBe("regular");
    expect(form.querySelector('input[name="workDate"]')?.getAttribute("value")).toBe("2026-08-04");
    expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
      "/team/attendance/fix?worker=x&date=2026-08-04",
    );
  });

  it("pre-fills NEITHER time field — a guessed timestamp is worse than an empty one", () => {
    const form = renderForm();
    const inTime = within(form).getByLabelText(/เวลาเข้าใหม่/);
    const outTime = within(form).getByLabelText(/เวลาออกใหม่/);
    expect(inTime.getAttribute("type")).toBe("time");
    expect(inTime.getAttribute("value")).toBeNull();
    expect(outTime.getAttribute("type")).toBe("time");
    expect(outTime.getAttribute("value")).toBeNull();
  });

  it("neither time field is required — a corrector may change just one", () => {
    const form = renderForm();
    expect(
      within(form)
        .getByLabelText(/เวลาเข้าใหม่/)
        .hasAttribute("required"),
    ).toBe(false);
    expect(
      within(form)
        .getByLabelText(/เวลาออกใหม่/)
        .hasAttribute("required"),
    ).toBe(false);
  });

  it("shows the CURRENT recorded times as facts, not as input defaults", () => {
    const form = renderForm({
      currentInAt: "2026-08-04T01:15:00Z",
      currentOutAt: "2026-08-04T10:30:00Z",
    });
    expect(within(form).getByText(/ปัจจุบัน/)).toBeTruthy();
  });

  it("leaves the out-time field enabled and undisclosed when it is NOT locked", () => {
    const form = renderForm({ outLocked: false });
    expect(
      within(form)
        .getByLabelText(/เวลาออกใหม่/)
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(within(form).queryByText(/บันทึกโดยคนแล้ว/)).toBeNull();
  });

  it("disables and discloses the out-time field once a HUMAN recorded it", () => {
    const form = renderForm({ outLocked: true, currentOutAt: "2026-08-04T10:30:00Z" });
    expect(
      within(form)
        .getByLabelText(/เวลาออกใหม่/)
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(within(form).getByText(/บันทึกโดยคนแล้ว/)).toBeTruthy();
  });

  it("labels an OT session distinctly from a regular one", () => {
    renderForm({ session: "ot" });
    expect(screen.getByText(/^OT$/)).toBeTruthy();
  });
});

// The row's SHAPE. A time value is five characters; the fields shipped at
// `w-full`, so in a wide card each one spanned the whole thing and the screen
// read as broken even where it was not. jsdom cannot measure that, so what is
// pinned is the instruction that produces it: an explicit width once there is
// room for a row.
describe("AttendanceFixRetimeForm — the correction reads as one row", () => {
  it("sizes both time fields to their content instead of the whole card", () => {
    const form = renderForm();
    for (const name of ["inTime", "outTime"]) {
      const field = form.querySelector(`input[name="${name}"]`);
      const classes = field?.className.split(/\s+/) ?? [];
      // `w-full` stays for the narrow box, where a full-bleed field is right.
      expect(classes).toContain("w-full");
      // ⚠️ Spec 404 U2b — a CONTAINER variant, not the `sm:` VIEWPORT one this
      // asserted before. This form is docked into a 280–340px column beside the
      // spec-404 calendar as well as into a full-width page, and `sm:` fired on
      // both: measured in real Chrome, the two fields sat at 212px each inside
      // a 280px panel while the viewport said "you have 834px".
      expect(classes.some((c) => /^@[a-z0-9]+:w-\d/.test(c))).toBe(true);
      expect(classes.some((c) => /^sm:/.test(c))).toBe(false);
    }
  });

  it("keeps เข้า and ออก SIDE BY SIDE at every width, not just the wide one", () => {
    // Operator, 2026-08-08: "เข้าออก side by side is better".
    //
    // U2b was right to stop this form taking its wide layout inside the
    // calendar's 280–340px docked panel, but the narrow layout it fell back to
    // stacks the two fields — and they are ONE RANGE, not two independent
    // questions. The corrector is replacing a pair and has to read it as a pair.
    //
    // So the two fields get their own wrapper that is a ROW unconditionally,
    // while the rest of the form still stacks in a narrow box. Pinned
    // structurally (a shared parent, no column direction anywhere on it)
    // because jsdom has no layout engine and cannot see where they land.
    const form = renderForm();
    const inEl = form.querySelector('input[name="inTime"]')!;
    const outEl = form.querySelector('input[name="outTime"]')!;

    // The nearest ancestor that contains BOTH — their pair wrapper.
    let pair: HTMLElement = inEl.parentElement!;
    while (!pair.contains(outEl)) pair = pair.parentElement!;
    expect(pair).not.toBe(form);

    const cls = pair.className.split(/\s+/);
    expect(cls).toContain("flex");
    // A row at EVERY width: no direction variant may switch it, and no
    // unprefixed column either. This is the whole assertion — a wrapper that
    // becomes a column in a narrow box is exactly the layout being replaced.
    expect(cls.some((c) => /(^|:)flex-col$/.test(c))).toBe(false);
    expect(cls.some((c) => /^(sm|md|lg|xl|2xl):/.test(c))).toBe(false);
    // …and it must not WRAP either, which is the same failure by another route:
    // a third child (or a long label) would push ออก onto its own line with
    // every assertion above still green.
    expect(cls).not.toContain("flex-wrap");
    // The wrapper is now ONE flex item, so the outer row's `@md:items-end` no
    // longer reaches the labels — it has to align them itself or a label that
    // wraps at a different width offsets its input.
    expect(cls).toContain("items-end");
  });

  it("gives the narrow pair enough room for the NATIVE time control", () => {
    // Measured in real Chrome at the DESIGN font: Chrome's `type="time"` control
    // has a fixed intrinsic width of `100px + horizontal padding` at 15px, and
    // it CLIPS SILENTLY — `scrollWidth` never grows, so only its own intrinsic
    // size can answer this.
    //
    // In the calendar panel the field box is **102px** at `md:w-[280px]` and
    // **112px** at the 300px this unit moved it to; the control needs 124 at
    // `px-3`, 116 at `px-2`, **108 at `px-1`**. So `px-1` plus the wider panel
    // is what makes the pair possible, and the padding is restored at `@md`
    // where the field is a comfortable 128px.
    const form = renderForm();
    for (const name of ["inTime", "outTime"]) {
      const cls = form.querySelector(`input[name="${name}"]`)!.className.split(/\s+/);
      expect(cls).toContain("px-1");
      expect(cls).toContain("@md:px-3");
      // …and the base `px-3` from FIELD_INPUT must be GONE, not merely
      // overridden by source order — Tailwind resolves conflicting utilities by
      // CSS order, not by attribute order, so leaving both is a coin flip.
      expect(cls).not.toContain("px-3");
      // 🚨 THE ONE THAT WOULD HAVE CAUGHT THE REGRESSION. The first version of
      // this built the class list with `cn(FIELD_INPUT, "px-2 …")`, and
      // tailwind-merge classifies `text-body` in its text-COLOUR group — so it
      // deleted `text-body` along with `px-3`. Tailwind's preflight sets
      // `font: inherit` on `input`, so the control inherited its label's
      // `text-[11px]` and SHIPPED AT 11px. Nothing failed; the whole geometry
      // measurement was then taken at the wrong font and read as "it fits".
      expect(cls).toContain("text-body");
    }
  });

  it("states the blank-means-unchanged rule ONCE, outside the field labels", () => {
    const form = renderForm();
    // It is a rule about the form, not the name of either field — a label
    // should label. One home means the two fields cannot come to disagree.
    expect(within(form).getAllByText(/กรอกเฉพาะช่องที่ต้องการแก้/)).toHaveLength(1);
    for (const re of [/เวลาเข้าใหม่/, /เวลาออกใหม่/]) {
      expect(within(form).getByLabelText(re).getAttribute("name")).toMatch(/^(in|out)Time$/);
    }
    expect(within(form).queryByLabelText(/เว้นว่าง/)).toBeNull();
  });

  it("shows the current pair as ONE range, so the correction reads old → new", () => {
    const form = renderForm({
      currentInAt: "2026-08-04T01:05:00Z",
      currentOutAt: "2026-08-04T10:00:00Z",
    });
    expect(within(form).getByText("08:05 – 17:00")).toBeTruthy();
  });

  it("names the missing half of an open session rather than printing a dash", () => {
    const form = renderForm({ currentInAt: "2026-08-04T10:25:00Z", currentOutAt: null });
    expect(within(form).getByText(/ยังไม่เช็คออก/)).toBeTruthy();
  });
});
