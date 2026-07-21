// Spec 318 U3 — the notification catalog SSOT: one entry per
// notification_event_type (compile-time via satisfies Record<...>), Thai
// labels, category grouping, role-audience gates, and the locked set.

import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATALOG_BY_EVENT,
  NOTIFICATION_CATEGORY_ORDER,
  NOTIFICATION_CATEGORY_LABEL,
  LOCKED_NOTIFICATION_EVENTS,
} from "@/lib/notifications/notification-catalog";

const ALL_EVENTS = [
  "wp_pending_approval",
  "wp_decision",
  "pr_created",
  "pr_decision",
  "pr_progress",
  "pr_cancelled",
  "feedback_submitted",
  "wp_reopened",
  "site_issue_reported",
  "receipt_correction_flagged",
  "receipt_correction_resolved",
  "wp_evidence_resubmitted",
] as const;

describe("notification catalog", () => {
  it("has exactly one entry per notification_event_type enum value", () => {
    expect(NOTIFICATION_CATALOG.map((e) => e.event).sort()).toEqual([...ALL_EVENTS].sort());
    for (const event of ALL_EVENTS) {
      expect(NOTIFICATION_CATALOG_BY_EVENT[event]).toBeDefined();
    }
  });

  it("locks exactly the safety alert", () => {
    expect(LOCKED_NOTIFICATION_EVENTS).toEqual(["site_issue_reported"]);
    expect(NOTIFICATION_CATALOG_BY_EVENT.site_issue_reported.locked).toBe(true);
    expect(NOTIFICATION_CATALOG.filter((e) => e.locked)).toHaveLength(1);
  });

  it("every entry carries a Thai label, description, and known category", () => {
    for (const entry of NOTIFICATION_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(NOTIFICATION_CATEGORY_ORDER).toContain(entry.category);
      expect(NOTIFICATION_CATEGORY_LABEL[entry.category].length).toBeGreaterThan(0);
    }
  });

  it("audience gates match the recipient rules", () => {
    const byEvent = NOTIFICATION_CATALOG_BY_EVENT;
    // PM-tier events
    expect(byEvent.wp_pending_approval.audience("project_manager")).toBe(true);
    expect(byEvent.wp_pending_approval.audience("site_admin")).toBe(false);
    // uploader events reach site admins
    expect(byEvent.wp_decision.audience("site_admin")).toBe(true);
    expect(byEvent.wp_reopened.audience("site_admin")).toBe(true);
    // PR requester events reach raisers (SA + procurement + PM tier)
    expect(byEvent.pr_progress.audience("site_admin")).toBe(true);
    expect(byEvent.pr_progress.audience("procurement")).toBe(true);
    expect(byEvent.pr_progress.audience("legal")).toBe(false);
    // operator-only
    expect(byEvent.feedback_submitted.audience("super_admin")).toBe(true);
    expect(byEvent.feedback_submitted.audience("project_manager")).toBe(false);
    // safety alert: PM tier + procurement_manager
    expect(byEvent.site_issue_reported.audience("procurement_manager")).toBe(true);
    expect(byEvent.site_issue_reported.audience("technician")).toBe(false);
    // spec 324: correction flag reaches the back-office authority, not the field
    expect(byEvent.receipt_correction_flagged.audience("procurement")).toBe(true);
    expect(byEvent.receipt_correction_flagged.audience("technician")).toBe(false);
    // spec 324: correction result reaches the SA who flagged (site staff)
    expect(byEvent.receipt_correction_resolved.audience("site_admin")).toBe(true);
    expect(byEvent.receipt_correction_resolved.audience("legal")).toBe(false);
    // spec 337 U1: the re-shoot ping goes back to the DECIDER — PM tier, never
    // the SA who resubmitted.
    expect(byEvent.wp_evidence_resubmitted.audience("project_manager")).toBe(true);
    expect(byEvent.wp_evidence_resubmitted.audience("site_admin")).toBe(false);
  });
});
