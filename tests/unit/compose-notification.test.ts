import { describe, expect, it } from "vitest";
import { composeNotification } from "@/lib/notifications/compose-notification";

describe("composeNotification", () => {
  it("composes wp_pending_approval from the payload snapshot", () => {
    expect(
      composeNotification("wp_pending_approval", { code: "WP-001", name: "งานเทพื้น" }, {}),
    ).toBe("งานรอตรวจ: WP-001 งานเทพื้น");
  });

  it("composes wp_decision with the Thai decision label and WP code from context", () => {
    expect(
      composeNotification(
        "wp_decision",
        { decision: "needs_revision", comment: "รูปช่วงหลังไม่ชัด" },
        { wpCode: "WP-001" },
      ),
    ).toBe("ผลการตรวจ WP-001: ให้แก้ไข\nความเห็น: รูปช่วงหลังไม่ชัด");
  });

  it("omits the comment line when wp_decision has no comment", () => {
    expect(composeNotification("wp_decision", { decision: "approved" }, { wpCode: "WP-001" })).toBe(
      "ผลการตรวจ WP-001: อนุมัติแล้ว",
    );
  });

  it("composes wp_reopened with the round + WP, pointing back to the app (spec 218)", () => {
    expect(
      composeNotification("wp_reopened", { code: "WP-014", name: "ผนังกันตก", round: 2 }, {}),
    ).toBe("งานถูกเปิดใหม่เพื่อแก้ไข (รอบ 2): WP-014 ผนังกันตก — เปิดแอปดูข้อบกพร่อง");
  });

  it("drops the round suffix for a legacy reopen with round 0", () => {
    expect(composeNotification("wp_reopened", { code: "WP-014", name: "ผนัง", round: 0 }, {})).toBe(
      "งานถูกเปิดใหม่เพื่อแก้ไข: WP-014 ผนัง — เปิดแอปดูข้อบกพร่อง",
    );
  });

  it("composes pr_created with the padded PR number, item, and quantity", () => {
    expect(
      composeNotification(
        "pr_created",
        { prNumber: 7, itemDescription: "ปูน", quantity: 10, unit: "ถุง" },
        {},
      ),
    ).toBe("คำขอซื้อใหม่ PR-0007: ปูน (10 ถุง)");
  });

  it("composes pr_decision from the transition target with comment", () => {
    expect(
      composeNotification(
        "pr_decision",
        {
          prNumber: 12,
          transition: ["requested", "rejected"],
          decisionComment: "ของมีในสต็อกแล้ว",
        },
        {},
      ),
    ).toBe("คำขอซื้อ PR-0012: ไม่อนุมัติ\nความเห็น: ของมีในสต็อกแล้ว");
  });

  it("composes pr_progress from the transition target without a comment line", () => {
    expect(
      composeNotification(
        "pr_progress",
        { prNumber: 12, transition: ["purchased", "on_route"] },
        {},
      ),
    ).toBe("คำขอซื้อ PR-0012: กำลังจัดส่ง");
  });

  it("composes pr_cancelled with the reason when present", () => {
    expect(
      composeNotification(
        "pr_cancelled",
        { prNumber: 3, cancellationReason: "ไม่ต้องการแล้ว" },
        {},
      ),
    ).toBe("คำขอซื้อ PR-0003 ถูกยกเลิก\nเหตุผล: ไม่ต้องการแล้ว");
  });

  it("composes pr_cancelled without a reason line when absent", () => {
    expect(composeNotification("pr_cancelled", { prNumber: 3 }, {})).toBe(
      "คำขอซื้อ PR-0003 ถูกยกเลิก",
    );
  });

  // Spec 211 U8 (critic gap X1) — a PR notification that belongs to a PO names the
  // ใบสั่งซื้อ, so the recipient knows which ORDER the line is part of (the PR-vs-PO
  // level confusion no longer reaches them pre-screen). The PO comes via context
  // (compose-time enrichment); absent → the message is unchanged.
  it("names the parent PO on a pr_progress when the PR belongs to one", () => {
    expect(
      composeNotification(
        "pr_progress",
        { prNumber: 12, transition: ["purchased", "on_route"] },
        { poNumber: 3 },
      ),
    ).toBe("คำขอซื้อ PR-0012 · ใบสั่งซื้อ PO-0003: กำลังจัดส่ง");
  });

  it("names the parent PO on a pr_decision when the PR belongs to one", () => {
    expect(
      composeNotification(
        "pr_decision",
        { prNumber: 12, transition: ["requested", "approved"] },
        { poNumber: 3 },
      ),
    ).toBe("คำขอซื้อ PR-0012 · ใบสั่งซื้อ PO-0003: อนุมัติแล้ว");
  });

  it("leaves a PR notification unchanged when there is no parent PO", () => {
    expect(
      composeNotification(
        "pr_progress",
        { prNumber: 12, transition: ["purchased", "on_route"] },
        {},
      ),
    ).toBe("คำขอซื้อ PR-0012: กำลังจัดส่ง");
  });

  it("composes feedback_submitted with the type label, reporter role, and title (A4)", () => {
    expect(
      composeNotification(
        "feedback_submitted",
        { feedbackType: "bug", roleSnapshot: "site_admin", feedbackTitle: "รูปอัปโหลดไม่ขึ้น" },
        {},
      ),
    ).toBe("ข้อเสนอแนะใหม่ (ปัญหา) จากผู้ดูแลหน้างาน: รูปอัปโหลดไม่ขึ้น");
  });

  it("composes a feature feedback_submitted with the feature label", () => {
    expect(
      composeNotification(
        "feedback_submitted",
        { feedbackType: "feature", roleSnapshot: "project_manager", feedbackTitle: "ขอกลุ่มวัสดุ" },
        {},
      ),
    ).toBe("ข้อเสนอแนะใหม่ (ฟีเจอร์) จากผู้จัดการโครงการ: ขอกลุ่มวัสดุ");
  });

  // Spec 277 P1a — serious site-issue alert: type label + project/WP scope +
  // reporter + a deep link into the project (enriched by the drain).
  it("composes site_issue_reported with the type label, project · WP scope, reporter, and deep link", () => {
    expect(
      composeNotification(
        "site_issue_reported",
        { issueType: "safety" },
        {
          projectName: "PRC-2026-004",
          wpCode: "WP-012",
          issueReporterName: "สมชาย ใจดี",
          issueDeepLink: "https://ops.example.app/projects/p1",
        },
      ),
    ).toBe(
      "⚠️ ปัญหาหน้างาน (ความปลอดภัย/อุบัติเหตุ): PRC-2026-004 · WP-012\nแจ้งโดย สมชาย ใจดี\nhttps://ops.example.app/projects/p1",
    );
  });

  it("composes site_issue_reported with a WP but no project name (no dangling separator)", () => {
    expect(
      composeNotification("site_issue_reported", { issueType: "equipment" }, { wpCode: "WP-012" }),
    ).toBe("⚠️ ปัญหาหน้างาน (เครื่องจักร/อุปกรณ์เสีย): WP-012");
  });

  it("composes site_issue_reported without a WP (project scope only)", () => {
    expect(
      composeNotification(
        "site_issue_reported",
        { issueType: "access" },
        {
          projectName: "PRC-2026-004",
          issueReporterName: "สมชาย ใจดี",
          issueDeepLink: "https://ops.example.app/projects/p1",
        },
      ),
    ).toBe(
      "⚠️ ปัญหาหน้างาน (เข้าพื้นที่ไม่ได้): PRC-2026-004\nแจ้งโดย สมชาย ใจดี\nhttps://ops.example.app/projects/p1",
    );
  });
});
