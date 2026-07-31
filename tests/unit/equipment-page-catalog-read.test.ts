// Spec 385 U2 — pin the page's catalog read SHAPE. equipment_catalog_items is
// column-granted and `default_daily_rate` has NO authenticated grant, so a
// `select("*")` does not return nulls — PostgREST refuses the WHOLE read and the
// picker silently gets nothing (the worker_level_rates class). The page is a
// Server Component vitest cannot render, so the pin is a source scan:
// comment-stripped, and asserting both presence AND the absent hazard.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/app/equipment/page.tsx", "utf8")
  .split("\n")
  // Line-based comment strip (the photomarkup lesson: mid-line // after code is
  // rare here and a URL-bearing line must not be truncated — drop only lines
  // that START as comments).
  .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
  .join("\n");

describe("equipment page — catalog read shape (spec 385 U2)", () => {
  it("reads equipment_catalog_items with the projected column list, active only", () => {
    expect(src).toContain('from("equipment_catalog_items")');
    expect(src).toContain('"id, name, category_id, brand, model, default_tracking"');
    expect(src).toContain('.eq("is_active", true)');
  });

  it("never selects * from the column-granted catalog (the whole read would 42501)", () => {
    expect(src).not.toMatch(/equipment_catalog_items"\)\s*\.select\(\s*"\s*\*\s*"/);
  });

  it("passes the catalog to the manager", () => {
    expect(src).toContain("catalogSkus={");
  });
});
