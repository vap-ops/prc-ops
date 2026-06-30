// Writing failing test first.
//
// Spec 226 / 207 U3c — the WpCategoryControl picker shows the project's ACTIVE
// work-categories only, BUT if the WP is already bound to a now-inactive
// category it must still render that category as the current value (otherwise
// the select would silently drop the binding). This pure helper is that filter.

import { describe, it, expect } from "vitest";
import { categoryPickerOptions, type WpCategoryOption } from "@/lib/work-packages/category-picker";

const cat = (id: string, code: string, name: string, is_active: boolean): WpCategoryOption => ({
  id,
  code,
  name,
  is_active,
});

describe("categoryPickerOptions", () => {
  const active1 = cat("a1", "W02", "งานโครงสร้าง", true);
  const active2 = cat("a2", "W03", "งานสถาปัตยกรรม", true);
  const inactive = cat("i1", "W09", "งานเก่า", false);

  it("keeps only active categories when nothing is bound", () => {
    const out = categoryPickerOptions([active1, inactive, active2], null);
    expect(out.map((o) => o.id)).toEqual(["a1", "a2"]);
  });

  it("keeps a bound-inactive category so it can render as the current value", () => {
    const out = categoryPickerOptions([active1, inactive, active2], "i1");
    expect(out.map((o) => o.id)).toEqual(["a1", "i1", "a2"]);
  });

  it("does not duplicate a bound-active category", () => {
    const out = categoryPickerOptions([active1, active2], "a1");
    expect(out.map((o) => o.id)).toEqual(["a1", "a2"]);
  });

  it("preserves input order (sort_order)", () => {
    const out = categoryPickerOptions([active2, active1], null);
    expect(out.map((o) => o.id)).toEqual(["a2", "a1"]);
  });

  it("returns no options when the project has no active categories and none bound", () => {
    expect(categoryPickerOptions([inactive], null)).toEqual([]);
  });
});
