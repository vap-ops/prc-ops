// Spec 191 U1 — Thai phone + tax-id format/validate helpers. Pure functions,
// shared by the contact form field inputs (client) and the server actions
// (canonicalize on write). Phone = 10 digits 0XXXXXXXXX, displayed 0XX-XXX-XXXX.
// Tax id = 13 digits, displayed X-XXXX-XXXXX-XX-X (the standard Thai grouping).

import { describe, expect, it } from "vitest";
import {
  digitsOnly,
  formatThaiPhone,
  isValidThaiPhone,
  formatThaiTaxId,
  isValidThaiTaxId,
} from "@/lib/contacts/thai-format";

describe("digitsOnly", () => {
  it("strips every non-digit", () => {
    expect(digitsOnly("081-234-5678")).toBe("0812345678");
    expect(digitsOnly(" 1-2 a 3 ")).toBe("123");
    expect(digitsOnly("")).toBe("");
  });
});

describe("isValidThaiPhone", () => {
  it("accepts 9 or 10 digits starting with 0 (landline or mobile, raw or formatted)", () => {
    expect(isValidThaiPhone("0812345678")).toBe(true); // 10-digit mobile
    expect(isValidThaiPhone("081-234-5678")).toBe(true);
    expect(isValidThaiPhone("02-1234-5678")).toBe(true); // 10 digits
    expect(isValidThaiPhone("02-123-4567")).toBe(true); // 9-digit Bangkok landline
    expect(isValidThaiPhone("021234567")).toBe(true); // 9 digits raw
  });
  it("rejects fewer than 9 or more than 10 digits, wrong lead digit, empty", () => {
    expect(isValidThaiPhone("")).toBe(false);
    expect(isValidThaiPhone("02123456")).toBe(false); // 8
    expect(isValidThaiPhone("08123456789")).toBe(false); // 11
    expect(isValidThaiPhone("181234567")).toBe(false); // 9 but no leading 0
  });
});

describe("formatThaiPhone", () => {
  it("groups as 3-3-4 progressively, capping at 10 digits", () => {
    expect(formatThaiPhone("081")).toBe("081");
    expect(formatThaiPhone("0812")).toBe("081-2");
    expect(formatThaiPhone("081234")).toBe("081-234");
    expect(formatThaiPhone("0812345678")).toBe("081-234-5678");
    expect(formatThaiPhone("08123456789999")).toBe("081-234-5678");
  });
  it("re-formats already-dashed input and ignores junk", () => {
    expect(formatThaiPhone("081-234-5678")).toBe("081-234-5678");
    expect(formatThaiPhone("")).toBe("");
  });
});

describe("isValidThaiTaxId", () => {
  it("accepts exactly 13 digits (raw or formatted)", () => {
    expect(isValidThaiTaxId("1234567890123")).toBe(true);
    expect(isValidThaiTaxId("1-2345-67890-12-3")).toBe(true);
  });
  it("rejects wrong length and empty", () => {
    expect(isValidThaiTaxId("")).toBe(false);
    expect(isValidThaiTaxId("123456789012")).toBe(false); // 12
    expect(isValidThaiTaxId("12345678901234")).toBe(false); // 14
  });
});

describe("formatThaiTaxId", () => {
  it("groups as 1-4-5-2-1 progressively, capping at 13 digits", () => {
    expect(formatThaiTaxId("1")).toBe("1");
    expect(formatThaiTaxId("12345")).toBe("1-2345");
    expect(formatThaiTaxId("1234567890123")).toBe("1-2345-67890-12-3");
    expect(formatThaiTaxId("1234567890123999")).toBe("1-2345-67890-12-3");
  });
});
