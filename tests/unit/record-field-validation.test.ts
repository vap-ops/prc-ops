// Spec 191 U2 — the VAT→TaxID required gate. recordHasErrors blocks submit when
// a requiredWhenTruthy field (taxId) is empty while its gate (isVatRegistered) is
// "true", and always on a bad-format phone/taxid. Pure logic, shared by the add +
// edit forms.

import { describe, expect, it } from "vitest";
import {
  recordHasErrors,
  type RecordFieldDef,
} from "@/components/features/purchasing/record-manager";

const FIELDS: RecordFieldDef[] = [
  { key: "name", label: "ชื่อ", type: "text", maxLength: 200 },
  { key: "isVatRegistered", label: "VAT", type: "vat" },
  { key: "taxId", label: "เลขผู้เสียภาษี", type: "taxid", requiredWhenTruthy: "isVatRegistered" },
];

describe("recordHasErrors — VAT→TaxID gate (spec 191 U2)", () => {
  it("blocks when the name is blank", () => {
    expect(recordHasErrors(FIELDS, { name: "", isVatRegistered: "false", taxId: "" })).toBe(true);
  });

  it("allows a non-VAT supplier with no tax id", () => {
    expect(recordHasErrors(FIELDS, { name: "ก", isVatRegistered: "false", taxId: "" })).toBe(false);
  });

  it("requires the tax id once VAT is on", () => {
    expect(recordHasErrors(FIELDS, { name: "ก", isVatRegistered: "true", taxId: "" })).toBe(true);
  });

  it("accepts a VAT supplier with a valid 13-digit tax id", () => {
    expect(
      recordHasErrors(FIELDS, { name: "ก", isVatRegistered: "true", taxId: "1-2345-67890-12-3" }),
    ).toBe(false);
  });

  it("rejects a malformed tax id even when optional (VAT off)", () => {
    expect(recordHasErrors(FIELDS, { name: "ก", isVatRegistered: "false", taxId: "123" })).toBe(
      true,
    );
  });
});
