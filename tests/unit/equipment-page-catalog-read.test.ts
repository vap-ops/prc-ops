// Spec 385 U2 — pin the page's catalog read SHAPE. equipment_catalog_items is
// column-granted and `default_daily_rate` has NO authenticated grant, so a
// `select("*")` does not return nulls — PostgREST refuses the WHOLE read and the
// picker silently gets nothing (the worker_level_rates class). The page is a
// Server Component vitest cannot render, so the pin is a source scan:
// comment-stripped, and asserting both presence AND the absent hazard.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stripComments = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    // Line-based comment strip (the photomarkup lesson: mid-line // after code is
    // rare here and a URL-bearing line must not be truncated — drop only lines
    // that START as comments).
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

const src = stripComments("src/app/equipment/page.tsx");
// Spec 385 U3a — the catalog PAGE reads the same column-granted table; its wall
// is the same wall (and its component money test is structurally vacuous, so
// THIS pin is the one that bites on a select("*") regression).
const catalogSrc = stripComments("src/app/equipment/catalog/page.tsx");

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

describe("equipment CATALOG page — read shape (spec 385 U3a/U3b)", () => {
  it("projects the granted columns and never selects * from the walled table", () => {
    expect(catalogSrc).toContain(
      '"id, name, category_id, brand, model, default_tracking, is_active"',
    );
    expect(catalogSrc).not.toMatch(/equipment_catalog_items"\)\s*\.select\(\s*"\s*\*\s*"/);
  });

  it("reads the money column ONLY through the admin seam (spec 385 U3b)", () => {
    // The RLS projection above must never gain the walled column; the one
    // sanctioned read is the admin client's rate map.
    expect(catalogSrc).toContain("createAdminSupabase");
    expect(catalogSrc).toContain('"id, default_daily_rate"');
    // Exactly two mentions — the admin projection and its map read. A third is
    // a new consumer that must justify itself against the wall.
    expect(catalogSrc).toContain("r.default_daily_rate");
    expect(catalogSrc.split("default_daily_rate").length - 1).toBe(2);
  });

  it("pages the instance-count read to exhaustion (db-max-rows is 1000)", () => {
    expect(catalogSrc).toContain(".range(start, start + PAGE - 1)");
  });
});
