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

  it("lets each date field shrink so it doesn't exceed the card (min-w-0)", () => {
    // The two period labels are the only text-xs <label>s on the page; each
    // wraps a native type="date" control whose intrinsic width must be allowed
    // to shrink, or it leaks the flex item past the card. Mirrors the
    // purchase-request-form date wrapper, which carries min-w-0.
    const dateLabels = src.match(/<label className="[^"]*text-xs[^"]*"/g) ?? [];
    expect(dateLabels.length).toBeGreaterThanOrEqual(2);
    for (const label of dateLabels) expect(label).toContain("min-w-0");
  });

  it("strips the native date control's intrinsic width (appearance-none + max-w-full)", () => {
    // WebKit date inputs ignore width:100% and overflow the card until the
    // native appearance is removed — the exact fix the purchase-request-form
    // date input already carries. Both period inputs must mirror it.
    const dateInputs = [...src.matchAll(/type="date"[\s\S]{0,200}?className=\{`([^`]*)`\}/g)];
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    for (const m of dateInputs) {
      expect(m[1]).toContain("appearance-none");
      expect(m[1]).toContain("max-w-full");
    }
  });
});
