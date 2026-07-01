import { describe, it, expect } from "vitest";
import {
  mapTemplateLinesToClonePayload,
  type TemplateLine,
} from "@/lib/supply-plan/clone-template";

// Spec 245 U2 — a template's plan lines map 1:1 to the bulk-add RPC's line
// shape. Cloned lines always land whole-project (workPackageId: null, D5).
describe("mapTemplateLinesToClonePayload", () => {
  it("maps catalogItemId and qty through unchanged", () => {
    const lines: TemplateLine[] = [{ catalogItemId: "item-1", qty: 12, note: "หมายเหตุ" }];
    expect(mapTemplateLinesToClonePayload(lines)).toEqual([
      { catalogItemId: "item-1", workPackageId: null, qty: 12, note: "หมายเหตุ" },
    ]);
  });

  it("always sets workPackageId to null", () => {
    const lines: TemplateLine[] = [{ catalogItemId: "item-1", qty: 1, note: null }];
    expect(mapTemplateLinesToClonePayload(lines)[0]?.workPackageId).toBeNull();
  });

  it("defaults a null note to an empty string", () => {
    const lines: TemplateLine[] = [{ catalogItemId: "item-1", qty: 1, note: null }];
    expect(mapTemplateLinesToClonePayload(lines)[0]?.note).toBe("");
  });

  it("maps multiple lines preserving order", () => {
    const lines: TemplateLine[] = [
      { catalogItemId: "a", qty: 1, note: null },
      { catalogItemId: "b", qty: 2, note: "x" },
    ];
    expect(mapTemplateLinesToClonePayload(lines).map((l) => l.catalogItemId)).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty template", () => {
    expect(mapTemplateLinesToClonePayload([])).toEqual([]);
  });
});
