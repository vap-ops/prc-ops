import { describe, expect, it } from "vitest";
import {
  buildNotificationMessage,
  joinWhere,
  purchaseRequestLink,
  workPackageLink,
  reviewWorkPackageLink,
  feedbackLink,
  storeCorrectionsLink,
  projectStoreLink,
  projectLink,
  PR_STATUS_ICON,
  WP_DECISION_ICON,
  FEEDBACK_TYPE_ICON,
} from "@/lib/notifications/message-skeleton";
import {
  PURCHASE_REQUEST_STATUS_LABEL,
  APPROVAL_DECISION_LABEL,
  FEEDBACK_TYPE_LABEL,
} from "@/lib/i18n/labels";

// Spec 402 U1 — the six-slot plain-text skeleton every push is composed onto.
// Pure: no env, no DB. The drain resolves the values, compose arranges them.

describe("buildNotificationMessage", () => {
  it("renders the six slots in order, one per line", () => {
    expect(
      buildNotificationMessage({
        headline: "🚚 กำลังจัดส่ง · คำขอซื้อ",
        subject: "ปูน",
        where: "โครงการบ้านสวย · PR-0012",
        actor: "สั่งซื้อแล้ว → กำลังจัดส่ง",
        note: "ความเห็น: รีบหน่อย",
        link: "https://app.example/requests/abc",
      }),
    ).toBe(
      [
        "🚚 กำลังจัดส่ง · คำขอซื้อ",
        "ปูน",
        "โครงการบ้านสวย · PR-0012",
        "สั่งซื้อแล้ว → กำลังจัดส่ง",
        "ความเห็น: รีบหน่อย",
        "https://app.example/requests/abc",
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

describe("purchaseRequestLink", () => {
  it("builds the /requests/<uuid> deep link", () => {
    expect(purchaseRequestLink("https://app.example", "11111111-1111-1111-1111-111111111111")).toBe(
      "https://app.example/requests/11111111-1111-1111-1111-111111111111",
    );
  });

  // NEXT_PUBLIC_APP_URL is operator-configured; a trailing slash would yield
  // a double slash that some clients refuse to linkify.
  it("tolerates a trailing slash on the base URL", () => {
    expect(purchaseRequestLink("https://app.example/", "abc")).toBe(
      "https://app.example/requests/abc",
    );
  });
});

// Spec 402 U2 — the work-package family's two links. Which one an event gets is
// a ROLE decision, not a cosmetic one: /review/work-packages is gated on
// PM_ROLES, so pointing an event whose recipients are photo uploaders at it
// would redirect every one of them.
describe("workPackageLink / reviewWorkPackageLink", () => {
  it("builds the project-scoped WP link through the nav SSOT", () => {
    expect(workPackageLink("https://app.example", "proj-1", "wp-1")).toBe(
      "https://app.example/projects/proj-1/work-packages/wp-1",
    );
  });

  it("builds the review-queue link, which needs no project", () => {
    expect(reviewWorkPackageLink("https://app.example", "wp-1")).toBe(
      "https://app.example/review/work-packages/wp-1",
    );
  });

  it("tolerates a trailing slash on the base URL for both", () => {
    expect(workPackageLink("https://app.example/", "proj-1", "wp-1")).toBe(
      "https://app.example/projects/proj-1/work-packages/wp-1",
    );
    expect(reviewWorkPackageLink("https://app.example/", "wp-1")).toBe(
      "https://app.example/review/work-packages/wp-1",
    );
  });
});

// Spec 402 U3 — the remaining events' links. Same rule as U2: each target is
// chosen to match its event's RECIPIENT set, because one outbox row yields one
// body for everyone who receives it.
describe("the spec 402 U3 links", () => {
  it("builds the feedback detail link (RLS-scoped, no requireRole)", () => {
    expect(feedbackLink("https://app.example", "fb-1")).toBe("https://app.example/feedback/fb-1");
  });

  // requireRole(BACK_OFFICE_ROLES) — exactly receipt_correction_flagged's
  // recipient set (context.backOfficeIds).
  it("builds the back-office corrections queue link", () => {
    expect(storeCorrectionsLink("https://app.example")).toBe(
      "https://app.example/store/corrections",
    );
  });

  // WP_DETAIL_ROLES, which includes site_admin — the flagger who receives
  // receipt_correction_resolved and cannot open the back-office queue.
  it("builds the project store link", () => {
    expect(projectStoreLink("https://app.example", "proj-1")).toBe(
      "https://app.example/projects/proj-1/store",
    );
  });

  it("builds the project link", () => {
    expect(projectLink("https://app.example", "proj-1")).toBe(
      "https://app.example/projects/proj-1",
    );
  });

  it("tolerates a trailing slash on every one of them", () => {
    expect(feedbackLink("https://app.example/", "fb-1")).toBe("https://app.example/feedback/fb-1");
    expect(storeCorrectionsLink("https://app.example/")).toBe(
      "https://app.example/store/corrections",
    );
    expect(projectStoreLink("https://app.example/", "p1")).toBe(
      "https://app.example/projects/p1/store",
    );
    expect(projectLink("https://app.example/", "p1")).toBe("https://app.example/projects/p1");
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
