// Regression guard (reported 2026-06-25, feedback 887ab7d8 "User can move the
// page around left-right"): the WP-detail tab strip laid its tabs as
// `flex-1 whitespace-nowrap` with NO `min-w-0`/`min-w-max` and NO overflow
// containment. A flex item's default min-width:auto refuses to shrink below its
// content, and whitespace-nowrap forbids wrapping — so on a narrow phone the 6
// tabs (ค่าใช้จ่าย · คำขอซื้อ · แรงงาน · อุปกรณ์ · ข้อมูล · จัดการ) overflow the
// row, and because nothing contained it the overflow escaped to the page
// scroller and the WHOLE page scrolled left-right.
//
// Fix: the tablist row contains its own horizontal overflow (overflow-x-auto,
// scrollbar hidden) and the tabs carry `min-w-max` so a label is never clipped
// mid-word (Thai clips badly — design doctrine). Tabs keep `flex-1` so they fill
// the row when they fit and only the strip scrolls when they don't — the page
// itself never moves. This test fails if either guard is dropped.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { WpDetailTabs } from "@/components/features/work-packages/wp-detail-tabs";

const TABS = [
  { key: "a", label: "ค่าใช้จ่าย", panel: <p>a</p> },
  { key: "b", label: "คำขอซื้อ", panel: <p>b</p> },
  { key: "c", label: "จัดการ", panel: <p>c</p> },
];

describe("wp-detail tab strip overflow containment", () => {
  it("the tablist contains its own horizontal overflow (never the page)", () => {
    const { container } = render(<WpDetailTabs tabs={TABS} />);
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist, "tablist not found").not.toBeNull();
    expect(tablist!.className).toContain("overflow-x-auto");
  });

  it("a tab can grow to fill but never shrinks below its label (no Thai clip)", () => {
    const { container } = render(<WpDetailTabs tabs={TABS} />);
    const tab = container.querySelector('[role="tab"]');
    expect(tab, "tab button not found").not.toBeNull();
    expect(tab!.className).toContain("flex-1");
    expect(tab!.className).toContain("min-w-max");
  });
});
