import { describe, expect, it } from "vitest";
import { Constants } from "@/lib/db/database.types";
import {
  approvalDecisionIcon,
  projectStatusIcon,
  purchaseOrderStatusIcon,
  purchaseRequestPriorityIcon,
  purchaseRequestStatusIcon,
  reportStatusIcon,
  workPackageStatusIcon,
} from "@/lib/status-icons";

// Spec 211 U4 — every status pill carries an icon as a colour-independent cue,
// single-sourced parallel to status-colors.ts so it renders identically on the
// worklist and every detail page. Guard: every enum value resolves to an icon
// (a missing value would render a pill with no glyph). Mirrors the i18n totality
// test — the Constants arrays come from the live schema, so a new enum value
// breaks here first.

// PO status is a derived union (not a DB enum); pin its states locally.
const PO_STATES = ["open", "ordered", "in_transit", "partially_received", "received"] as const;

describe("status icon SSOT covers every status value", () => {
  const cases: ReadonlyArray<[string, readonly string[], (v: never) => unknown]> = [
    ["work_package_status", Constants.public.Enums.work_package_status, workPackageStatusIcon],
    ["project_status", Constants.public.Enums.project_status, projectStatusIcon],
    ["approval_decision", Constants.public.Enums.approval_decision, approvalDecisionIcon],
    ["report_status", Constants.public.Enums.report_status, reportStatusIcon],
    [
      "purchase_request_priority",
      Constants.public.Enums.purchase_request_priority,
      purchaseRequestPriorityIcon,
    ],
    [
      "purchase_request_status",
      Constants.public.Enums.purchase_request_status,
      purchaseRequestStatusIcon,
    ],
  ];

  for (const [name, values, iconFor] of cases) {
    it(`maps every ${name} value to an icon`, () => {
      for (const value of values) {
        expect(iconFor(value as never), `${name}.${value} has no icon`).toBeTruthy();
      }
    });
  }

  it("maps every derived PO roll-up status to an icon", () => {
    for (const state of PO_STATES) {
      expect(purchaseOrderStatusIcon(state), `${state} has no icon`).toBeTruthy();
    }
  });

  it("returns an icon for the no-decision (null) approval state", () => {
    expect(approvalDecisionIcon(null)).toBeTruthy();
  });
});
