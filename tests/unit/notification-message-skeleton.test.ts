import { describe, expect, it } from "vitest";
import {
  buildNotificationMessage,
  joinWhere,
  purchaseRequestLink,
  PR_STATUS_ICON,
} from "@/lib/notifications/message-skeleton";
import { PURCHASE_REQUEST_STATUS_LABEL } from "@/lib/i18n/labels";

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
