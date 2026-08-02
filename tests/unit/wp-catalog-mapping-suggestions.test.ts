// Spec 389 U4 — the mapping-suggestion builder (pure).
//
// Two bases, in priority order:
//   1. old_id — the catalogue row's source_note carries "เดิม: WP-xxx"; the
//      Vol.2 name for that old id (data/wp-vol2-names.json) equals the live
//      WP's name. This is the strong bridge (~328 of 379 on โพธิ์ทอง).
//   2. name — the catalogue name equals the live WP name directly (Vol.4 kept
//      most names verbatim).
// Equality is whitespace-normalised. An AMBIGUOUS match (two candidates) or a
// grain mismatch (group vs leaf) yields NO suggestion — a wrong pre-selection
// is worse than an empty one.

import { describe, expect, it } from "vitest";
import { buildMappingSuggestions } from "@/lib/wp-catalog/mapping-suggestions";

const item = (o: {
  id: string;
  code: string;
  name: string;
  is_group?: boolean;
  source_note?: string | null;
}) => ({
  id: o.id,
  code: o.code,
  name: o.name,
  is_group: o.is_group ?? false,
  source_note: o.source_note ?? null,
});

const wp = (o: { id: string; code: string; name: string; is_group?: boolean }) => ({
  id: o.id,
  code: o.code,
  name: o.name,
  is_group: o.is_group ?? false,
});

describe("buildMappingSuggestions", () => {
  it("suggests via the old_id bridge when the Vol.2 name matches the live WP", () => {
    const items = [
      item({
        id: "i1",
        code: "S-01-01",
        name: "ชื่อใหม่ใน Vol.4",
        source_note: "เดิม: WP-001 · ใหม่ (Vol.4)",
      }),
    ];
    const wps = [wp({ id: "w1", code: "WP-01-01", name: "ชื่อเก่าใน Vol.2" })];
    const vol2 = { "WP-001": "ชื่อเก่าใน Vol.2" };

    const out = buildMappingSuggestions(wps, items, vol2);
    expect(out.get("w1")).toEqual({ itemId: "i1", basis: "old_id" });
  });

  it("falls back to direct name equality (whitespace-normalised)", () => {
    const items = [item({ id: "i1", code: "S-01-01", name: "งานทำรั้ว ชั่วคราว" })];
    const wps = [wp({ id: "w1", code: "WP-01-06", name: "งานทำรั้วชั่วคราว " })];

    const out = buildMappingSuggestions(wps, items, {});
    expect(out.get("w1")).toEqual({ itemId: "i1", basis: "name" });
  });

  it("yields NO suggestion when two catalogue items share the matching name", () => {
    const items = [
      item({ id: "i1", code: "S-01-01", name: "งานซ้ำ" }),
      item({ id: "i2", code: "S-02-01", name: "งานซ้ำ" }),
    ];
    const wps = [wp({ id: "w1", code: "WP-01", name: "งานซ้ำ" })];

    const out = buildMappingSuggestions(wps, items, {});
    expect(out.has("w1")).toBe(false);
  });

  it("never crosses the group/leaf grain", () => {
    const items = [item({ id: "i1", code: "S-01", name: "งานฐานราก", is_group: true })];
    const wps = [wp({ id: "w1", code: "WP-04-01", name: "งานฐานราก", is_group: false })];

    const out = buildMappingSuggestions(wps, items, {});
    expect(out.has("w1")).toBe(false);
  });

  it("matches a group WP to a group item", () => {
    const items = [item({ id: "i1", code: "S-01", name: "งานฐานราก", is_group: true })];
    const wps = [wp({ id: "w1", code: "WP-04", name: "งานฐานราก", is_group: true })];

    const out = buildMappingSuggestions(wps, items, {});
    expect(out.get("w1")).toEqual({ itemId: "i1", basis: "name" });
  });

  it("an AMBIGUOUS old_id bridge yields no suggestion — it must NOT fall through to a name match", () => {
    // Two catalogue rows whose OldIDs both resolve to the WP's name: the strong
    // basis is ambiguous, and the weaker name basis must not rescue one of them
    // (that is exactly the wrong-pre-selection this builder exists to avoid).
    const items = [
      item({ id: "i1", code: "S-01-01", name: "ชื่ออื่น", source_note: "เดิม: WP-001" }),
      item({ id: "i2", code: "S-02-02", name: "งานเก่า", source_note: "เดิม: WP-002" }),
    ];
    const wps = [wp({ id: "w1", code: "WP-09", name: "งานเก่า" })];
    const vol2 = { "WP-001": "งานเก่า", "WP-002": "งานเก่า" };

    const out = buildMappingSuggestions(wps, items, vol2);
    expect(out.has("w1")).toBe(false);
  });

  it("prefers the old_id bridge over a conflicting name match", () => {
    const items = [
      item({
        id: "bridge",
        code: "S-01-01",
        name: "ชื่อแก้ไขแล้ว",
        source_note: "เดิม: WP-005",
      }),
      item({ id: "nameonly", code: "S-02-02", name: "งานทำรั้วชั่วคราว" }),
    ];
    const wps = [wp({ id: "w1", code: "WP-01-06", name: "งานทำรั้วชั่วคราว" })];
    const vol2 = { "WP-005": "งานทำรั้วชั่วคราว" };

    const out = buildMappingSuggestions(wps, items, vol2);
    expect(out.get("w1")).toEqual({ itemId: "bridge", basis: "old_id" });
  });
});
