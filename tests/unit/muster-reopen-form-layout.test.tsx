// The reopen form's ROW GEOMETRY, pinned after it shipped broken.
//
// `basis-full` is a WRAPPED-row instruction: it means "take a whole line of your
// own". In a `flex-nowrap` row there is no next line, so the browser treats it
// as a 100%-wide item competing with its siblings — and since the reason label
// is `flex-1 min-w-0`, it is the one that absorbs the whole deficit. Measured on
// a real 1194px viewport before the fix: label width **0px**, its Thai text
// wrapped one character per line into a 279px-tall column, the reason input
// 26px wide (its own padding) and the submit button painted on top of it.
//
// jsdom has no layout engine, so no RTL assertion can see any of that. What CAN
// be pinned is the invariant that produced it: a `basis-full` child requires a
// row that wraps.
//
// The live-browser measurement is the real evidence (recorded in the PR); this
// is the regression pin.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MusterReopenForm } from "@/components/features/muster/muster-reopen-form";
import { MUSTER_DAY_REOPEN_MEANING } from "@/lib/i18n/labels";

function renderForm(canClose = true) {
  render(
    <MusterReopenForm
      projectId="p1"
      workDate="2026-08-05"
      returnTo="/team/attendance/fix?worker=w1&date=2026-08-05"
      canClose={canClose}
    />,
  );
  return screen.getByRole("form", { name: /^เปิดวัน/ });
}

describe("the reopen form's row", () => {
  it("gives every basis-full child a row that can wrap", () => {
    const form = renderForm();
    const claimsWholeLine = Array.from(form.children).filter((el) =>
      el.className.split(/\s+/).some((c) => c === "basis-full" || c.endsWith(":basis-full")),
    );
    // The two prose lines — what the action MEANS, above the control, and what
    // happens next, below it — each claim a line of their own. If nothing does,
    // this test has stopped testing anything.
    expect(claimsWholeLine.length).toBeGreaterThan(0);
    expect(claimsWholeLine.map((el) => el.tagName)).toEqual(claimsWholeLine.map(() => "P"));

    // …so the row it sits in must wrap at every width where the row is a ROW.
    // The form is `flex-col` below `sm`, where wrapping is moot.
    const rowClasses = form.className.split(/\s+/);
    expect(rowClasses).toContain("sm:flex-row");
    expect(rowClasses).toContain("sm:flex-wrap");
  });

  // Operator, 2026-08-07: "ปิด เปิด วัน is not clear. provide instructions if
  // you want to use these words." The vocabulary is used across 29 files, so
  // the app owes the reader a plain sentence at the point of ACTION — read from
  // the shared home, because this form renders on two surfaces.
  it("says what เปิดวัน means, above the control and from the shared home", () => {
    const form = renderForm();
    const meaning = within(form).getByText(MUSTER_DAY_REOPEN_MEANING);
    const button = within(form).getByRole("button");
    // Above the control: a disclosure met after the button is met after the tap.
    expect(meaning.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …and it is a sentence about the ACT, not a repeat of the button's name.
    expect(MUSTER_DAY_REOPEN_MEANING.length).toBeGreaterThan(30);
  });

  it("keeps the reason field able to hold its own width", () => {
    const form = renderForm();
    const label = form.querySelector("label");
    // `min-w-0` is what let the label collapse to zero once something else
    // claimed the whole line; it is only safe on a row that wraps (above).
    expect(label?.className).toContain("flex-1");
    expect(screen.getByPlaceholderText(/ลงเวลาไม่ครบ/)).toBeInTheDocument();
  });
});
