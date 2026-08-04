// Writing failing test first.
//
// Spec 396 U3 — telling a NORMALISATION apart from a REPLACEMENT.
//
// This is the whole judgement of the unit. On 2026-08-04 there were 22
// back-office renames of workers, 11 of them on records belonging to a real
// person's own account — and TEN of those eleven were a bulk pass adding
// นาย/นาง/นางสาว prefixes, ten of them inside 90 seconds. The eleventh replaced
// a person. A confirm that fires on all eleven would be dismissed by muscle
// memory before it ever met the one that mattered.
//
// So: same person, tidier spelling ⇒ silent. Different person ⇒ confirm.

import { describe, expect, it } from "vitest";

import { isNormalisingRename, normaliseThaiPersonName } from "@/lib/workers/thai-name";

describe("normaliseThaiPersonName", () => {
  it("strips the honorifics that appear in this roster", () => {
    // Every one of these is live data as of 2026-08-04.
    expect(normaliseThaiPersonName("นายจรูญ โสภา")).toBe("จรูญโสภา");
    expect(normaliseThaiPersonName("นางลัดดา สินค่ำคูณ")).toBe("ลัดดาสินค่ำคูณ");
    expect(normaliseThaiPersonName("นางสาว สังวาลย์ มาลา")).toBe("สังวาลย์มาลา");
    expect(normaliseThaiPersonName("น.ส.สายฝน เข็มวงศ์")).toBe("สายฝนเข็มวงศ์");
    expect(normaliseThaiPersonName("ด.ช.อนันตชัย ฑีฆายุทธสกุล")).toBe("อนันตชัยฑีฆายุทธสกุล");
  });

  it("collapses all whitespace, including the double spaces the roster is full of", () => {
    expect(normaliseThaiPersonName("นางแก้ว  บุญวัง")).toBe(
      normaliseThaiPersonName("นางแก้ว บุญวัง"),
    );
    expect(normaliseThaiPersonName("  จรูญ โสภา  ")).toBe("จรูญโสภา");
  });

  it("leaves a name with no honorific alone", () => {
    expect(normaliseThaiPersonName("สุรินทร์ นาคพันธุ์")).toBe("สุรินทร์นาคพันธุ์");
  });

  it("only strips an honorific at the START, never mid-name", () => {
    // A person whose given name legitimately begins with those syllables must
    // not be silently truncated.
    expect(normaliseThaiPersonName("สมนาย ใจดี")).toBe("สมนายใจดี");
  });
});

describe("isNormalisingRename", () => {
  it("treats adding an honorific as a normalisation — the common, benign case", () => {
    // 10 of the 11 real renames on bound workers were exactly this.
    expect(isNormalisingRename("จรูญ โสภา", "นายจรูญ โสภา")).toBe(true);
    expect(isNormalisingRename("ลัดดา สินค่ำคูณ", "นางลัดดา สินค่ำคูณ")).toBe(true);
  });

  it("treats a whitespace tidy-up as a normalisation", () => {
    expect(isNormalisingRename("นางแก้ว  บุญวัง", "นางแก้ว บุญวัง")).toBe(true);
  });

  it("treats swapping one person for another as NOT a normalisation", () => {
    // The 2026-08-04 incident, exactly: aemon's record renamed to a เหิน.
    expect(isNormalisingRename("เอมอร ฮามศรีพรม", "นายเหิน เมืองงาม")).toBe(false);
  });

  it("treats a real spelling correction as NOT a normalisation", () => {
    // Conservative on purpose: a changed surname is a changed person until a
    // human says otherwise. Confirming here costs one press; being wrong the
    // other way costs an employee's record.
    expect(isNormalisingRename("นายอนันตชัย ทีฆายุมธสกุล", "นายอนันตชัย ทีฆายุทธสกุล")).toBe(false);
  });

  it("treats an unchanged name as a normalisation (nothing to confirm)", () => {
    expect(isNormalisingRename("นายจรูญ โสภา", "นายจรูญ โสภา")).toBe(true);
    expect(isNormalisingRename("นายจรูญ โสภา", "  นายจรูญ โสภา  ")).toBe(true);
  });

  it("treats an honorific SWAP as a normalisation, not a replacement", () => {
    // นาย → นางสาว is a correction to the same human's record, not a new human.
    expect(isNormalisingRename("นายสมชาย ใจดี", "นางสาวสมชาย ใจดี")).toBe(true);
  });
});
