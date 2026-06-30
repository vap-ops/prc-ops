// Spec 214 — product-code format: empty (unset) or exactly six ASCII digits.
// Spec 221 U4 — the code is COMPOSED from the taxonomy (category + subcategory
// codes) + a typed sequence tail.
import { describe, expect, it } from "vitest";
import {
  composeProductCode,
  isValidProductCode,
  parseItemFields,
  productCodeTailLength,
} from "@/lib/catalog/validate";

describe("isValidProductCode (spec 214)", () => {
  it("accepts an empty / blank code (unset)", () => {
    expect(isValidProductCode("")).toBe(true);
    expect(isValidProductCode("   ")).toBe(true);
  });

  it("accepts exactly six digits", () => {
    expect(isValidProductCode("010120")).toBe(true);
    expect(isValidProductCode("000000")).toBe(true);
    expect(isValidProductCode("999999")).toBe(true);
  });

  it("rejects anything that is not six digits", () => {
    expect(isValidProductCode("12345")).toBe(false); // 5
    expect(isValidProductCode("1234567")).toBe(false); // 7
    expect(isValidProductCode("12AB56")).toBe(false); // letters
    expect(isValidProductCode("01-01-20")).toBe(false); // punctuation
    expect(isValidProductCode("๐๑๐๑๒๐")).toBe(false); // Thai digits are not ASCII
  });
});

describe("productCodeTailLength (spec 221 U4)", () => {
  it("is 4 when there is no subcategory (prefix = the 2-digit category code)", () => {
    expect(productCodeTailLength("06", "")).toBe(4);
  });

  it("is 2 when a subcategory is chosen (prefix = category + subcategory = 4 digits)", () => {
    expect(productCodeTailLength("06", "01")).toBe(2);
  });
});

describe("composeProductCode (spec 221 U4)", () => {
  it("composes category + subcategory + tail into the stored 6-digit code", () => {
    expect(composeProductCode("01", "02", "50")).toBe("010250");
  });

  it("composes category + a 4-digit tail when there is no subcategory", () => {
    expect(composeProductCode("06", "", "0120")).toBe("060120");
  });

  it("yields an empty code when the tail is blank (the code is optional)", () => {
    expect(composeProductCode("06", "01", "")).toBe("");
    expect(composeProductCode("06", "01", "   ")).toBe("");
  });
});

// Spec 239 U2-fields — parse the optional form strings (search synonyms + lead
// time days) into RPC args (empty → "" / null; the RPC omit-when-empty clears).
describe("parseItemFields (spec 239 U2-fields)", () => {
  it("trims search terms and parses a non-negative integer lead time", () => {
    expect(parseItemFields({ searchTerms: "  rebar เหล็กเส้น  ", leadTimeDays: "7" })).toEqual({
      ok: true,
      searchTerms: "rebar เหล็กเส้น",
      leadTimeDays: 7,
    });
  });

  it("treats blank inputs as empty / null (both fields optional)", () => {
    expect(parseItemFields({})).toEqual({ ok: true, searchTerms: "", leadTimeDays: null });
    expect(parseItemFields({ searchTerms: "   ", leadTimeDays: "  " })).toEqual({
      ok: true,
      searchTerms: "",
      leadTimeDays: null,
    });
  });

  it("accepts a zero lead time", () => {
    expect(parseItemFields({ leadTimeDays: "0" })).toEqual({
      ok: true,
      searchTerms: "",
      leadTimeDays: 0,
    });
  });

  it("rejects a negative or non-integer lead time", () => {
    expect(parseItemFields({ leadTimeDays: "-1" }).ok).toBe(false);
    expect(parseItemFields({ leadTimeDays: "2.5" }).ok).toBe(false);
    expect(parseItemFields({ leadTimeDays: "abc" }).ok).toBe(false);
  });

  it("rejects an over-long search-terms string (<=500)", () => {
    expect(parseItemFields({ searchTerms: "x".repeat(501) }).ok).toBe(false);
    expect(parseItemFields({ searchTerms: "x".repeat(500) }).ok).toBe(true);
  });
});
