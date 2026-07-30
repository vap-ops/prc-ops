// Writing failing test first.
//
// Spec 381 U2 — turning one history row into a Thai line the operator can read.
//
// The kinds come from the U1 RPC, which unions four sources with different
// shapes: `movement_*` (five kinds), `loan_out` / `loan_returned`,
// `item_updated` (a field diff), and `rate_change` (money — only ever present
// for the back-office audience).
//
// Two things this pins that would otherwise rot quietly:
//   1. every kind the RPC can emit has a label — an unlabelled kind must not
//      render as a raw enum string to a Thai-only field user;
//   2. the field names inside an `item_updated` diff are the SAME Thai words the
//      edit sheet uses. A history saying "name changed" while the form says
//      "ชื่ออุปกรณ์" makes the reader do a translation the app should have done.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_HISTORY_KIND_LABEL,
  EQUIPMENT_FIELD_LABEL,
  describeHistoryEntry,
} from "@/lib/equipment/history-labels";

describe("EQUIPMENT_HISTORY_KIND_LABEL", () => {
  // The exhaustive set the U1 RPC can return: 'movement_' || equipment_movement_kind
  // for the five movement kinds, plus the four synthesised kinds.
  const KINDS_THE_RPC_EMITS = [
    "movement_received",
    "movement_deployed",
    "movement_returned",
    "movement_maintenance",
    "movement_lost",
    "loan_out",
    "loan_returned",
    "item_updated",
    "rate_change",
  ] as const;

  it("labels every kind the RPC can emit", () => {
    for (const kind of KINDS_THE_RPC_EMITS) {
      const label = EQUIPMENT_HISTORY_KIND_LABEL[kind];
      expect(label, `missing label for ${kind}`).toBeTruthy();
      // A raw enum string leaking to a Thai-only user is the failure being
      // prevented, so assert the label is not just the key echoed back.
      expect(label).not.toBe(kind);
    }
  });

  it("carries no labels for kinds the RPC cannot emit", () => {
    expect(Object.keys(EQUIPMENT_HISTORY_KIND_LABEL).sort()).toEqual(
      [...KINDS_THE_RPC_EMITS].sort(),
    );
  });
});

describe("EQUIPMENT_FIELD_LABEL", () => {
  // Exactly the fields the U1 trigger diffs. If the trigger's list grows, this
  // reds — which is the point: a new audited field with no label renders raw.
  const AUDITED_FIELDS = [
    "name",
    "category_id",
    "owner_id",
    "status",
    "tracking",
    "asset_tag",
    "quantity",
    "brand",
    "model",
    "serial_no",
    "condition",
    "description",
    "image_path",
  ] as const;

  it("labels every field the trigger records", () => {
    for (const f of AUDITED_FIELDS) {
      expect(EQUIPMENT_FIELD_LABEL[f], `missing label for ${f}`).toBeTruthy();
    }
  });

  it("uses the same words as the edit form, not the column names", () => {
    expect(EQUIPMENT_FIELD_LABEL.name).toBe("ชื่ออุปกรณ์");
    expect(EQUIPMENT_FIELD_LABEL.category_id).toBe("หมวดหมู่");
    expect(EQUIPMENT_FIELD_LABEL.owner_id).toBe("เจ้าของ");
    expect(EQUIPMENT_FIELD_LABEL.status).toBe("สถานะ");
    expect(EQUIPMENT_FIELD_LABEL.asset_tag).toBe("รหัสครุภัณฑ์");
  });
});

describe("describeHistoryEntry", () => {
  it("summarises an edit as the Thai field names that changed", () => {
    expect(
      describeHistoryEntry({
        kind: "item_updated",
        detail: { changes: { name: { from: "ก", to: "ข" }, status: { from: "a", to: "b" } } },
      }),
    ).toBe("ชื่ออุปกรณ์ · สถานะ");
  });

  it("falls back to the raw key for a field it does not know, rather than dropping it", () => {
    // Dropping would under-report the change; showing the key is ugly but honest,
    // and the test above is what stops it happening for known fields.
    expect(describeHistoryEntry({ kind: "item_updated", detail: { changes: { zzz: {} } } })).toBe(
      "zzz",
    );
  });

  it("returns null when there is nothing extra worth saying", () => {
    expect(describeHistoryEntry({ kind: "movement_returned", detail: {} })).toBeNull();
    expect(describeHistoryEntry({ kind: "item_updated", detail: {} })).toBeNull();
  });

  it("shows a rate change as before → after in baht", () => {
    expect(
      describeHistoryEntry({
        kind: "rate_change",
        detail: { kind: "rate_change", old_rate: null, new_rate: 250 },
      }),
    ).toBe("ค่าเช่า/วัน: — → ฿250");
    expect(
      describeHistoryEntry({
        kind: "rate_change",
        detail: { kind: "rate_change", old_rate: 250, new_rate: 300 },
      }),
    ).toBe("ค่าเช่า/วัน: ฿250 → ฿300");
  });

  it("names the note on a movement when there is one", () => {
    expect(
      describeHistoryEntry({ kind: "movement_deployed", detail: { note: "ส่งไปไซต์บางนา" } }),
    ).toBe("ส่งไปไซต์บางนา");
  });
});
