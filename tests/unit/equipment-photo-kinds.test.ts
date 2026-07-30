// Writing failing test first.
//
// Spec 382 U2 — the four slots as one SSOT: order, Thai label, the instruction
// line, and the completeness count the row chip renders.
//
// The order is not cosmetic. It is the order someone standing at the machine
// should shoot in: the whole machine, then the plate they have to crouch for,
// then the badge, then our sticker — which they may have to go and apply first.
// Putting qr_tag anywhere but last would send them back to the printer mid-flow.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_PHOTO_KINDS,
  EQUIPMENT_PHOTO_LABEL,
  EQUIPMENT_PHOTO_HINT,
  photoCompleteness,
} from "@/lib/equipment/photo-kinds";

describe("EQUIPMENT_PHOTO_KINDS", () => {
  it("is the four kinds the DB enum allows, in shooting order", () => {
    expect(EQUIPMENT_PHOTO_KINDS).toEqual(["item", "nameplate", "brand", "qr_tag"]);
  });

  it("labels and hints every kind — no slot ships unexplained", () => {
    for (const k of EQUIPMENT_PHOTO_KINDS) {
      expect(EQUIPMENT_PHOTO_LABEL[k], `label for ${k}`).toBeTruthy();
      expect(EQUIPMENT_PHOTO_HINT[k], `hint for ${k}`).toBeTruthy();
      // The hint must say something the label does not — a hint that repeats the
      // label is decoration, and the operator asked for instructions.
      expect(EQUIPMENT_PHOTO_HINT[k]).not.toBe(EQUIPMENT_PHOTO_LABEL[k]);
    }
  });

  it("uses the operator's own words for the slots", () => {
    expect(EQUIPMENT_PHOTO_LABEL.item).toBe("รูปอุปกรณ์");
    expect(EQUIPMENT_PHOTO_LABEL.brand).toBe("ยี่ห้อ");
    // The nameplate hint has one job: get the serial number in frame.
    expect(EQUIPMENT_PHOTO_HINT.nameplate).toContain("ซีเรียล");
    // And the QR slot is OUR sticker, on the machine — not the printed sheet.
    expect(EQUIPMENT_PHOTO_HINT.qr_tag).toContain("ติดบนเครื่อง");
  });
});

describe("photoCompleteness", () => {
  it("counts distinct kinds present, out of four", () => {
    expect(photoCompleteness([])).toEqual({ have: 0, total: 4 });
    expect(photoCompleteness(["item"])).toEqual({ have: 1, total: 4 });
    expect(photoCompleteness(["item", "nameplate", "brand", "qr_tag"])).toEqual({
      have: 4,
      total: 4,
    });
  });

  it("never double-counts a repeated kind", () => {
    // The DB refuses a duplicate, but the chip must not depend on that to be
    // correct — a stale client list must never read 5/4.
    expect(photoCompleteness(["item", "item"])).toEqual({ have: 1, total: 4 });
  });

  it("ignores a kind it does not recognise instead of inflating the count", () => {
    expect(photoCompleteness(["item", "something_else"])).toEqual({ have: 1, total: 4 });
  });
});
