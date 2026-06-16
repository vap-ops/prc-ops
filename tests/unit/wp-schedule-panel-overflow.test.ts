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
