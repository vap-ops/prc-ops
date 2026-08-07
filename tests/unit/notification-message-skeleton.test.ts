import { describe, expect, it } from "vitest";
import {
  buildNotificationMessage,
  joinWhere,
  PR_STATUS_ICON,
  WP_DECISION_ICON,
  FEEDBACK_TYPE_ICON,
} from "@/lib/notifications/message-skeleton";
import {
  PURCHASE_REQUEST_STATUS_LABEL,
  APPROVAL_DECISION_LABEL,
  FEEDBACK_TYPE_LABEL,
} from "@/lib/i18n/labels";

// Spec 402 — the five-slot plain-text skeleton every push is composed onto.
// Pure: no env, no DB. The drain resolves the values, compose arranges them.
// U4 removed a sixth slot that carried a URL; see notification-no-deep-links.

describe("buildNotificationMessage", () => {
  it("renders the five slots in order, one per line", () => {
    expect(
      buildNotificationMessage({
        headline: "🚚 กำลังจัดส่ง · คำขอซื้อ",
        subject: "ปูน",
        where: "โครงการบ้านสวย · PR-0012",
        actor: "สั่งซื้อแล้ว → กำลังจัดส่ง",
        note: "ความเห็น: รีบหน่อย",
      }),
    ).toBe(
      [
        "🚚 กำลังจัดส่ง · คำขอซื้อ",
        "ปูน",
        "โครงการบ้านสวย · PR-0012",
        "สั่งซื้อแล้ว → กำลังจัดส่ง",
        "ความเห็น: รีบหน่อย",
      ].join("\n"),
    );
  });

  // The headline is the only required slot: a phone's notification shelf
  // truncates at one or two lines, so it carries the discriminator.
  it("drops absent slots without leaving a blank line", () => {
    expect(buildNotificationMessage({ headline: "🆕 คำขอซื้อใหม่", where: "PR-0007" })).toBe(
      "🆕 คำขอซื้อใหม่\nPR-0007",
    );
  });

  // An unresolved name arrives as "" or a whitespace string, never as a
  // rendered "โดย undefined" — the honest-copy rule.
  it("drops whitespace-only slots and trims the rest", () => {
    expect(
      buildNotificationMessage({
        headline: "  🆕 คำขอซื้อใหม่  ",
        subject: "   ",
        where: "PR-0007",
        actor: "",
      }),
    ).toBe("🆕 คำขอซื้อใหม่\nPR-0007");
  });

  it("returns the headline alone when nothing else resolved", () => {
    expect(buildNotificationMessage({ headline: "🆕 คำขอซื้อใหม่" })).toBe("🆕 คำขอซื้อใหม่");
  });
});

describe("joinWhere", () => {
  it("joins the parts it has with a middle dot", () => {
    expect(joinWhere(["โครงการบ้านสวย", "PR-0012", "ใบสั่งซื้อ PO-0003"])).toBe(
      "โครงการบ้านสวย · PR-0012 · ใบสั่งซื้อ PO-0003",
    );
  });

  it("drops absent and blank parts so no dangling separator survives", () => {
    expect(joinWhere([undefined, "PR-0012", "  ", ""])).toBe("PR-0012");
  });

  it("returns an empty string when every part is absent", () => {
    expect(joinWhere([undefined, undefined])).toBe("");
  });
});

describe("FEEDBACK_TYPE_ICON", () => {
  it("covers the complete feedback_type domain", () => {
    expect(Object.keys(FEEDBACK_TYPE_ICON).sort()).toEqual(Object.keys(FEEDBACK_TYPE_LABEL).sort());
  });

  it("gives every type a non-empty icon", () => {
    for (const [type, icon] of Object.entries(FEEDBACK_TYPE_ICON)) {
      expect(icon, `type ${type} has no icon`).not.toBe("");
    }
  });
});

describe("WP_DECISION_ICON", () => {
  it("covers the complete approval_decision domain", () => {
    expect(Object.keys(WP_DECISION_ICON).sort()).toEqual(
      Object.keys(APPROVAL_DECISION_LABEL).sort(),
    );
  });

  it("gives every decision a non-empty icon", () => {
    for (const [decision, icon] of Object.entries(WP_DECISION_ICON)) {
      expect(icon, `decision ${decision} has no icon`).not.toBe("");
    }
  });
});

describe("PR_STATUS_ICON", () => {
  // An icon table keyed by hand silently falls through when the enum grows.
  // PURCHASE_REQUEST_STATUS_LABEL is a Record over purchase_request_status, so
  // its keys ARE the domain — pin equality, not containment.
  it("covers the complete purchase_request_status domain", () => {
    expect(Object.keys(PR_STATUS_ICON).sort()).toEqual(
      Object.keys(PURCHASE_REQUEST_STATUS_LABEL).sort(),
    );
  });

  it("gives every status a non-empty icon", () => {
    for (const [status, icon] of Object.entries(PR_STATUS_ICON)) {
      expect(icon, `status ${status} has no icon`).not.toBe("");
    }
  });
});
