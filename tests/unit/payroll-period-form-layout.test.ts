// Regression guard (reported 2026-06-14): the ค่าแรง DC period picker overlapped
// on phone. The form was `flex flex-wrap items-end` always-on, so on a narrow
// viewport the two type="date" inputs (FIELD_INPUT = w-full min-w-0) cramped
// side by side and shrank below the native control's content width — the date
// digits collided with the calendar icon inside each field. Fix: stack on phone
// (flex-col), only go row on sm+ — so each date field is full-width on phone and
// the input keeps enough room. Same pattern the project settings-form uses.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/payroll/page.tsx"), "utf8");

describe("payroll period form layout", () => {
  it("stacks the date fields on phone, rows on sm+ (no overlap)", () => {
    // The period picker is the page's only <form method="get">.
    const i = src.indexOf('method="get"');
    expect(i, "period form not found").toBeGreaterThan(-1);
    // The className template has no '>' in it, so the first '>' closes the tag.
    const tag = src.slice(i, src.indexOf(">", i));
    expect(tag).toContain("flex-col"); // stacked on phone
    expect(tag).toContain("sm:flex-row"); // side-by-side only when there's room
  });
});
