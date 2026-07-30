// Spec 382 U2 — the four photo slots as one SSOT.
//
// Order is the order to SHOOT in, standing at the machine: the whole machine
// first, then the plate you have to crouch for, then the badge, then our own QR
// sticker — which may still need applying, so it goes last rather than sending
// someone back to the printer mid-flow.
//
// The hints are the "instructions" the operator asked for, in words that say what
// the label cannot: the nameplate slot's only job is to get the SERIAL in frame,
// and the QR slot means our sticker ON the machine, not the printed sheet.

export const EQUIPMENT_PHOTO_KINDS = ["item", "nameplate", "brand", "qr_tag"] as const;

export type EquipmentPhotoKind = (typeof EQUIPMENT_PHOTO_KINDS)[number];

export const EQUIPMENT_PHOTO_LABEL: Record<EquipmentPhotoKind, string> = {
  item: "รูปอุปกรณ์",
  nameplate: "เพลทเลขเครื่อง",
  brand: "ยี่ห้อ",
  qr_tag: "QR ของเรา",
};

export const EQUIPMENT_PHOTO_HINT: Record<EquipmentPhotoKind, string> = {
  item: "ถ่ายทั้งเครื่องให้เห็นรูปทรง ตั้งกล้องห่างพอให้เห็นทั้งชิ้น",
  nameplate: "ถ่ายป้ายโลหะข้างเครื่อง ให้เลขซีเรียลชัดอ่านออก",
  brand: "ถ่ายโลโก้หรือชื่อยี่ห้อบนตัวเครื่องให้ชัด",
  qr_tag: "ถ่ายสติกเกอร์ QR ของเราที่ติดบนเครื่องแล้ว",
};

export interface PhotoCompleteness {
  have: number;
  total: number;
}

/**
 * How many of the four slots are filled. Counts DISTINCT recognised kinds, so a
 * stale or duplicated client list can never read 5/4 — the chip must be right on
 * its own, not because the unique index happens to hold.
 */
export function photoCompleteness(kinds: readonly string[]): PhotoCompleteness {
  const known = new Set<string>(EQUIPMENT_PHOTO_KINDS);
  const present = new Set(kinds.filter((k) => known.has(k)));
  return { have: present.size, total: EQUIPMENT_PHOTO_KINDS.length };
}
