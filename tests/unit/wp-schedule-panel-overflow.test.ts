// Regression guard (reported 2026-06-14): the predecessor / "depends-on"
// picker on the WP schedule panel overflowed its container. The <select> is a
// flex child (flex-1) whose options are "{code} — {name}"; a long WP name sets
// the control's intrinsic min-width, and a flex item's default min-width:auto
// refuses to shrink below that — so the row exceeds PAGE_MAX_W on narrow
// viewports. The shared FIELD_INPUT / FIELD_SELECT constants carry min-w-0 for
// exactly this reason; the panel's local FIELD constant did not, so the fix
// pins min-w-0 on the picker itself. This test fails if min-w-0 is dropped.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/components/features/work-packages/wp-schedule-panel.tsx"),
  "utf8",
);

describe("wp-schedule-panel dependency picker", () => {
  it("the predecessor <select> can shrink in its flex row (min-w-0)", () => {
    // Locate the picker via its stable aria-label; the className (with the
    // flex sizing) sits on the line just after it, before the tag's `>`.
    const i = src.indexOf('aria-label="เลือกงานที่ต้องทำก่อน"');
    expect(i, "predecessor picker <select> not found").toBeGreaterThan(-1);
    const tag = src.slice(i, i + 200);
    // It grows to fill the row...
    expect(tag).toContain("flex-1");
    // ...and is allowed to shrink below its longest option's width.
    expect(tag).toContain("min-w-0");
  });
});

// Feedback 9b0d24b0 ("Date picker is in weird shape … it appears shrinking"):
// the เริ่ม/สิ้นสุด <input type="date"> on the จัดการ tab collapsed to tiny
// near-zero-width pills on iOS. Same root cause as the picker overflow above —
// the panel's LOCAL `FIELD` constant lacks the `w-full min-w-0` that the shared
// FIELD_INPUT/FIELD_SELECT carry, so an empty WebKit date input (whose intrinsic
// width is content-based, not viewport-based even with globals.css's
// appearance:none reset) took its min-content size inside a width-less flex-col
// label. The 2026-06-14 fix patched only the <select>; the date inputs still
// rode bare FIELD. Fix = the whole class: put the width constraints on FIELD,
// and stack the field row on mobile so each date input gets full width (the
// /team/attendance date-range precedent).
describe("wp-schedule-panel planned-window date inputs", () => {
  it("the local FIELD constant carries the width constraints (w-full, min-w-0)", () => {
    const m = src.match(/const FIELD =\s*"([^"]*)"/);
    expect(m, "FIELD constant not found").not.toBeNull();
    // Both date inputs render className={FIELD}, so the width lives here or nowhere.
    expect(m![1], "FIELD must set w-full so an empty iOS date input fills its label").toContain(
      "w-full",
    );
    expect(m![1], "FIELD must set min-w-0 so it can shrink in a flex row").toContain("min-w-0");
  });

  it("the planned-window row stacks on mobile so the date inputs get full width", () => {
    const i = src.indexOf("กำหนดการ (แผน)");
    expect(i, "planned-window heading not found").toBeGreaterThan(-1);
    // The field row is the sibling <div> right after the heading <p>; its
    // className is the next flex-* class attribute in source order.
    const row = src.slice(i).match(/className="(flex[^"]*)"/);
    expect(row, "planned-window field row not found").not.toBeNull();
    // Full-width stacked on phones, wrapping row only from sm: up.
    expect(row![1], "row must be flex-col on mobile").toContain("flex-col");
    expect(row![1], "row must become a row from sm: up").toContain("sm:flex-row");
  });
});
