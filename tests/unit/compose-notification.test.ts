import { describe, expect, it } from "vitest";
import {
  composeNotification,
  type NotificationEventType,
} from "@/lib/notifications/compose-notification";

describe("composeNotification", () => {
  // --- Spec 402 U2: the work-package family on the six-slot skeleton --------

  it("composes wp_pending_approval with the project and the review-queue link", () => {
    expect(
      composeNotification(
        "wp_pending_approval",
        { code: "WP-001", name: "งานเทพื้น", submittedBy: "22222222-2222-2222-2222-22222222feed" },
        {
          projectName: "โครงการบ้านสวย",
          submitterName: "สมชาย ใจดี",
          deepLink: "https://app.example/review/work-packages/wp-1",
        },
      ),
    ).toBe(
      [
        "🔎 งานรอตรวจ",
        "งานเทพื้น",
        "โครงการบ้านสวย · WP-001",
        "ส่งตรวจโดย สมชาย ใจดี",
        "https://app.example/review/work-packages/wp-1",
      ].join("\n"),
    );
  });

  it("degrades wp_pending_approval to the slots it has", () => {
    expect(
      composeNotification("wp_pending_approval", { code: "WP-001", name: "งานเทพื้น" }, {}),
    ).toBe("🔎 งานรอตรวจ\nงานเทพื้น\nWP-001");
  });

  // wp_decision's payload snapshots NOTHING about the work — no code, no name,
  // no project (verified live: 243 of 243 rows). All three reach the message
  // through the drain's work_packages join, which is why this was the thinnest
  // message in the WP family.
  it("composes wp_decision with the work it is about, resolved entirely from context", () => {
    expect(
      composeNotification(
        "wp_decision",
        { decision: "needs_revision", comment: "รูปช่วงหลังไม่ชัด" },
        {
          wpCode: "WP-001",
          wpName: "งานเทพื้น",
          projectName: "โครงการบ้านสวย",
          actorName: "พีเอ็มเอ",
          deepLink: "https://app.example/projects/p1/work-packages/wp-1",
        },
      ),
    ).toBe(
      [
        "🔁 ผลการตรวจ: ถ่ายรูปใหม่",
        "งานเทพื้น",
        "โครงการบ้านสวย · WP-001",
        "ตรวจโดย พีเอ็มเอ",
        "ความเห็น: รูปช่วงหลังไม่ชัด",
        "https://app.example/projects/p1/work-packages/wp-1",
      ].join("\n"),
    );
  });

  it("omits the comment line when wp_decision has no comment", () => {
    expect(composeNotification("wp_decision", { decision: "approved" }, { wpCode: "WP-001" })).toBe(
      "✅ ผลการตรวจ: อนุมัติแล้ว\nWP-001",
    );
  });

  it("uses the rejected icon for a rejected decision", () => {
    expect(composeNotification("wp_decision", { decision: "rejected" }, { wpCode: "WP-001" })).toBe(
      "⛔ ผลการตรวจ: งานต้องแก้ไข\nWP-001",
    );
  });

  // The old copy ended "— เปิดแอปดูข้อบกพร่อง", a stand-in for the link this unit
  // adds. Now that the link is real, the instruction is redundant and gone.
  it("composes wp_reopened with the round, and no longer tells the reader to open the app", () => {
    const message = composeNotification(
      "wp_reopened",
      { code: "WP-014", name: "ผนังกันตก", round: 2 },
      {
        projectName: "โครงการบ้านสวย",
        actorName: "พีเอ็มเอ",
        deepLink: "https://app.example/projects/p1/work-packages/wp-2",
      },
    );
    expect(message).toBe(
      [
        "🔁 เปิดงานใหม่เพื่อแก้ไข (รอบ 2)",
        "ผนังกันตก",
        "โครงการบ้านสวย · WP-014",
        "เปิดโดย พีเอ็มเอ",
        "https://app.example/projects/p1/work-packages/wp-2",
      ].join("\n"),
    );
    expect(message).not.toContain("เปิดแอปดูข้อบกพร่อง");
  });

  it("drops the round suffix for a legacy reopen with round 0", () => {
    expect(composeNotification("wp_reopened", { code: "WP-014", name: "ผนัง", round: 0 }, {})).toBe(
      "🔁 เปิดงานใหม่เพื่อแก้ไข\nผนัง\nWP-014",
    );
  });

  it("composes wp_evidence_resubmitted with the resubmitter and the review link", () => {
    expect(
      composeNotification(
        "wp_evidence_resubmitted",
        { code: "WP-044", name: "งานติดตั้งเสากันชน" },
        {
          projectName: "โครงการบ้านสวย",
          actorName: "สมชาย ใจดี",
          deepLink: "https://app.example/review/work-packages/wp-3",
        },
      ),
    ).toBe(
      [
        "📸 ส่งตรวจอีกครั้ง",
        "งานติดตั้งเสากันชน",
        "โครงการบ้านสวย · WP-044",
        "ถ่ายรูปเพิ่มโดย สมชาย ใจดี",
        "https://app.example/review/work-packages/wp-3",
      ].join("\n"),
    );
  });

  // --- Spec 402 U1: the purchase-request family on the six-slot skeleton ----
  // 81% of every push ever sent. Before this unit the whole family rendered one
  // line built from the PR number and a status word — pr_progress in particular
  // discarded the item_description its payload has always carried.

  it("composes pr_created on the skeleton with project, requester and deep link", () => {
    expect(
      composeNotification(
        "pr_created",
        {
          prNumber: 7,
          itemDescription: "ปูน",
          quantity: 10,
          unit: "ถุง",
          requestedBy: "11111111-1111-1111-1111-111111111111",
        },
        {
          projectName: "โครงการบ้านสวย",
          poNumber: 3,
          actorName: "สมชาย ใจดี",
          deepLink: "https://app.example/requests/pr-uuid",
        },
      ),
    ).toBe(
      [
        "🆕 คำขอซื้อใหม่",
        "ปูน × 10 ถุง",
        "โครงการบ้านสวย · PR-0007 · ใบสั่งซื้อ PO-0003",
        "ขอโดย สมชาย ใจดี",
        "https://app.example/requests/pr-uuid",
      ].join("\n"),
    );
  });

  it("degrades pr_created to the slots it has when the drain resolved nothing", () => {
    expect(
      composeNotification(
        "pr_created",
        { prNumber: 7, itemDescription: "ปูน", quantity: 10, unit: "ถุง" },
        {},
      ),
    ).toBe("🆕 คำขอซื้อใหม่\nปูน × 10 ถุง\nPR-0007");
  });

  it("omits the quantity clause on pr_created when the payload has no quantity", () => {
    expect(composeNotification("pr_created", { prNumber: 7, itemDescription: "ปูน" }, {})).toBe(
      "🆕 คำขอซื้อใหม่\nปูน\nPR-0007",
    );
  });

  it("composes pr_decision with the status icon, item, decider and comment", () => {
    expect(
      composeNotification(
        "pr_decision",
        {
          prNumber: 12,
          itemDescription: "กระเบื้อง",
          transition: ["requested", "rejected"],
          decisionComment: "ของมีในสต็อกแล้ว",
        },
        { projectName: "โครงการบ้านสวย", actorName: "สมชาย ใจดี" },
      ),
    ).toBe(
      [
        "⛔ คำขอซื้อ: ไม่อนุมัติ",
        "กระเบื้อง",
        "โครงการบ้านสวย · PR-0012",
        "โดย สมชาย ใจดี",
        "ความเห็น: ของมีในสต็อกแล้ว",
      ].join("\n"),
    );
  });

  it("composes pr_progress with the item it always carried and the FROM status", () => {
    expect(
      composeNotification(
        "pr_progress",
        {
          prNumber: 12,
          itemDescription: "เหล็กกล่อง กาวาไนซ์",
          transition: ["purchased", "on_route"],
        },
        {
          projectName: "โครงการบ้านสวย",
          poNumber: 3,
          deepLink: "https://app.example/requests/pr-uuid",
        },
      ),
    ).toBe(
      [
        "🚚 กำลังจัดส่ง · คำขอซื้อ",
        "เหล็กกล่อง กาวาไนซ์",
        "โครงการบ้านสวย · PR-0012 · ใบสั่งซื้อ PO-0003",
        "สั่งซื้อแล้ว → กำลังจัดส่ง",
        "https://app.example/requests/pr-uuid",
      ].join("\n"),
    );
  });

  // 🚨 notify_pr_status_change snapshots `decided_by` from `approved_by`, so on a
  // pr_progress row that uid is the PR's APPROVER — not whoever marked it
  // delivered. Naming them would attribute the delivery to the wrong person, so
  // pr_progress renders no actor even when the drain hands one over.
  it("never names an actor on pr_progress, because decided_by is the approver", () => {
    const message = composeNotification(
      "pr_progress",
      { prNumber: 12, itemDescription: "ปูน", transition: ["on_route", "delivered"] },
      { actorName: "สมชาย ใจดี" },
    );
    expect(message).not.toContain("สมชาย ใจดี");
    expect(message).toBe("📦 ได้รับของแล้ว · คำขอซื้อ\nปูน\nPR-0012\nกำลังจัดส่ง → ได้รับของแล้ว");
  });

  it("composes pr_cancelled with the item, canceller and reason", () => {
    expect(
      composeNotification(
        "pr_cancelled",
        {
          prNumber: 3,
          itemDescription: "ถุงตาข่ายไนลอน",
          cancellationReason: "ไม่ต้องการแล้ว",
        },
        { actorName: "สมชาย ใจดี" },
      ),
    ).toBe(
      [
        "🚫 คำขอซื้อถูกยกเลิก",
        "ถุงตาข่ายไนลอน",
        "PR-0003",
        "ยกเลิกโดย สมชาย ใจดี",
        "เหตุผล: ไม่ต้องการแล้ว",
      ].join("\n"),
    );
  });

  it("composes pr_cancelled without a reason line when absent", () => {
    expect(composeNotification("pr_cancelled", { prNumber: 3 }, {})).toBe(
      "🚫 คำขอซื้อถูกยกเลิก\nPR-0003",
    );
  });

  // Spec 211 U8 (critic gap X1) — a PR notification that belongs to a PO names the
  // ใบสั่งซื้อ, so the recipient knows which ORDER the line is part of (the PR-vs-PO
  // level confusion no longer reaches them pre-screen). The PO comes via context
  // (compose-time enrichment); absent → the ref slot carries the PR alone.
  it("names the parent PO on a pr_progress when the PR belongs to one", () => {
    expect(
      composeNotification(
        "pr_progress",
        { prNumber: 12, transition: ["purchased", "on_route"] },
        { poNumber: 3 },
      ),
    ).toContain("PR-0012 · ใบสั่งซื้อ PO-0003");
  });

  it("leaves the ref slot as the PR alone when there is no parent PO", () => {
    expect(
      composeNotification(
        "pr_progress",
        { prNumber: 12, transition: ["purchased", "on_route"] },
        {},
      ),
    ).toBe("🚚 กำลังจัดส่ง · คำขอซื้อ\nPR-0012\nสั่งซื้อแล้ว → กำลังจัดส่ง");
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

  // Spec 337 U1 (F2) — the SA answered a needs_revision and pressed
  // ส่งตรวจอีกครั้ง; the decider is told the WP is ready to look at again.
  it("composes wp_evidence_resubmitted naming the WP, degrading to the slots it has", () => {
    expect(
      composeNotification("wp_evidence_resubmitted", { code: "W05-03", name: "งานฉาบผนัง" }, {}),
    ).toBe("📸 ส่งตรวจอีกครั้ง\nงานฉาบผนัง\nW05-03");
  });

  // Hardening (2026-07-11) — an event type the compiled code predates must
  // compose to a neutral empty string: a safe skip, never `undefined` that
  // crashes the drain loop. Exhaustiveness for KNOWN events is preserved.
  it("composes a neutral empty string for an unrecognized (future) event type", () => {
    expect(
      composeNotification("some_future_event" as unknown as NotificationEventType, {}, {}),
    ).toBe("");
  });
});
