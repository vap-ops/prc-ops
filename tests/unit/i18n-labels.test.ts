import { describe, expect, it } from "vitest";
import { Constants } from "@/lib/db/database.types";
import {
  APPROVAL_DECISION_LABEL,
  PHOTO_PHASE_LABEL,
  PROJECT_STATUS_LABEL,
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  USER_ROLE_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  formatThaiDateTime,
} from "@/lib/i18n/labels";

// Every label map must cover its enum totally (the Constants arrays are
// generated from the live schema, so a new enum value breaks the build
// here first), every label must contain Thai script, and labels must be
// distinct within a map so two states never read identically.
const THAI_CHAR = /[฀-๿]/;

const MAPS = [
  ["work_package_status", Constants.public.Enums.work_package_status, WORK_PACKAGE_STATUS_LABEL],
  ["project_status", Constants.public.Enums.project_status, PROJECT_STATUS_LABEL],
  [
    "purchase_request_status",
    Constants.public.Enums.purchase_request_status,
    PURCHASE_REQUEST_STATUS_LABEL,
  ],
  [
    "purchase_request_priority",
    Constants.public.Enums.purchase_request_priority,
    PURCHASE_REQUEST_PRIORITY_LABEL,
  ],
  ["photo_phase", Constants.public.Enums.photo_phase, PHOTO_PHASE_LABEL],
  ["approval_decision", Constants.public.Enums.approval_decision, APPROVAL_DECISION_LABEL],
  ["user_role", Constants.public.Enums.user_role, USER_ROLE_LABEL],
] as const;

describe("Thai label maps", () => {
  for (const [name, values, map] of MAPS) {
    it(`covers every ${name} value with a distinct Thai label`, () => {
      for (const value of values) {
        const label = (map as Record<string, string>)[value];
        expect(label, `${name}.${value} missing`).toBeTruthy();
        expect(label, `${name}.${value} not Thai`).toMatch(THAI_CHAR);
      }
      const labels = values.map((v) => (map as Record<string, string>)[v]);
      expect(new Set(labels).size).toBe(values.length);
    });
  }
});

describe("PURCHASE_ORDER_STATUS_LABEL (derived roll-up, not a DB enum)", () => {
  // The union lives in purchasing/purchase-order.ts and has no Constants array;
  // pin the four states here so a new roll-up state must add a label.
  const PO_STATES = ["open", "ordered", "partially_received", "received"] as const;

  it("covers every derived PO status with a distinct Thai label", () => {
    for (const state of PO_STATES) {
      const label = PURCHASE_ORDER_STATUS_LABEL[state];
      expect(label, `${state} missing`).toBeTruthy();
      expect(label, `${state} not Thai`).toMatch(THAI_CHAR);
    }
    const labels = PO_STATES.map((s) => PURCHASE_ORDER_STATUS_LABEL[s]);
    expect(new Set(labels).size).toBe(PO_STATES.length);
  });
});

describe("formatThaiDateTime", () => {
  it("renders Buddhist-era Thai date-time pinned to Asia/Bangkok", () => {
    const s = formatThaiDateTime("2026-06-11T05:30:00Z");
    expect(s).toContain("2569"); // Buddhist era, not 2026
    expect(s).not.toContain("2026");
    expect(s).toContain("มิ.ย."); // Thai month abbreviation
    expect(s).toContain("12:30"); // 05:30Z = 12:30 Asia/Bangkok
  });

  it("is deterministic regardless of host timezone (UTC instant in, Bangkok wall clock out)", () => {
    // 17:10Z on the 11th = 00:10 on the 12th in Bangkok — date must roll.
    const s = formatThaiDateTime("2026-06-11T17:10:00Z");
    expect(s).toContain("12");
    expect(s).toContain("00:10");
  });

  it("returns the raw string for an unparseable timestamp instead of throwing", () => {
    // Preserves the failure mode of the two formatters this replaced:
    // Intl.format throws RangeError on Invalid Date, which would crash
    // the page into the error boundary; the raw string is the safe
    // degradation.
    expect(formatThaiDateTime("not-a-date")).toBe("not-a-date");
  });
});
