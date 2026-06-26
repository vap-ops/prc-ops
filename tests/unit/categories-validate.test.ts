// Spec 207 U3 — the หมวดงาน (project work-category) form validators. Fast
// client-side feedback; the create_project_category RPC + the unique
// (project_id, code) constraint are the real guards.

import { describe, it, expect } from "vitest";
import {
  CATEGORY_CODE_MAX,
  CATEGORY_NAME_MAX,
  validateCategoryCode,
  validateCategoryName,
} from "@/lib/categories/validate";

describe("validateCategoryCode", () => {
  it("trims and accepts a non-blank code", () => {
    expect(validateCategoryCode("  STRUCT  ")).toEqual({ ok: true, code: "STRUCT" });
  });
  it("rejects a blank code", () => {
    expect(validateCategoryCode("   ")).toEqual({ ok: false, error: "กรุณาใส่รหัสหมวดงาน" });
  });
  it("rejects a code over the max", () => {
    const result = validateCategoryCode("X".repeat(CATEGORY_CODE_MAX + 1));
    expect(result.ok).toBe(false);
  });
  it("accepts a code at exactly the max", () => {
    expect(validateCategoryCode("X".repeat(CATEGORY_CODE_MAX)).ok).toBe(true);
  });
});

describe("validateCategoryName", () => {
  it("trims and accepts a non-blank name", () => {
    expect(validateCategoryName("  งานโครงสร้าง  ")).toEqual({ ok: true, name: "งานโครงสร้าง" });
  });
  it("rejects a blank name", () => {
    expect(validateCategoryName("")).toEqual({ ok: false, error: "กรุณาใส่ชื่อหมวดงาน" });
  });
  it("rejects a name over the max", () => {
    expect(validateCategoryName("ก".repeat(CATEGORY_NAME_MAX + 1)).ok).toBe(false);
  });
});
