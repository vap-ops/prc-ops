// Spec 270 U5 — pure WP-picker shaping: a picker offers งานย่อย ONLY, grouped
// under งาน headings (optgroups) where the project adopted the hierarchy.
// Legacy flat projects: one flat option list, no headings.

import { describe, expect, it } from "vitest";
import { buildWpPickerGroups } from "@/lib/work-packages/picker-options";

interface Row {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
  parentId: string | null;
}

const leaf = (id: string, code: string, parentId: string | null = null): Row => ({
  id,
  code,
  name: `ชื่อ ${code}`,
  isGroup: false,
  parentId,
});
const group = (id: string, code: string): Row => ({
  id,
  code,
  name: `กลุ่ม ${code}`,
  isGroup: true,
  parentId: null,
});

describe("buildWpPickerGroups", () => {
  it("legacy flat project: one ungrouped bucket, no sections", () => {
    const r = buildWpPickerGroups([leaf("a", "WP-002"), leaf("b", "WP-001")]);
    expect(r.sections).toEqual([]);
    expect(r.ungrouped.map((o) => o.id)).toEqual(["b", "a"]); // sorted by code
  });

  it("adopted project: sections labeled by งาน, leaves inside sorted, groups never options", () => {
    const r = buildWpPickerGroups([
      group("g2", "WP-10"),
      group("g1", "WP-02"),
      leaf("c2", "WP-02-10", "g1"),
      leaf("c1", "WP-02-2", "g1"),
      leaf("d1", "WP-10-01", "g2"),
      leaf("loose", "WP-099"),
    ]);
    expect(r.sections.map((s) => s.label)).toEqual(["WP-02 กลุ่ม WP-02", "WP-10 กลุ่ม WP-10"]);
    expect(r.sections[0]?.options.map((o) => o.id)).toEqual(["c1", "c2"]);
    expect(r.sections[1]?.options.map((o) => o.id)).toEqual(["d1"]);
    expect(r.ungrouped.map((o) => o.id)).toEqual(["loose"]);
    const allIds = [...r.sections.flatMap((s) => s.options), ...r.ungrouped].map((o) => o.id);
    expect(allIds).not.toContain("g1");
    expect(allIds).not.toContain("g2");
  });

  it("empty งาน produces no empty optgroup", () => {
    const r = buildWpPickerGroups([group("g", "WP-05")]);
    expect(r.sections).toEqual([]);
    expect(r.ungrouped).toEqual([]);
  });
});
