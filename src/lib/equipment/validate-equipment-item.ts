// Spec 141 U1 §Tests — pure validation for the equipment-registry form.
// Enforces the serialized-vs-bulk tracking invariants (ADR 0055 decision 1):
//   unit  → no quantity, may carry an asset tag (one physical unit)
//   bulk  → quantity ≥ 1, never an asset tag (fungible stock)
// The DB CHECK constraints re-enforce these; this layer gives fast, Thai,
// friendly errors. Host-table-independent (category/owner ids validated by
// the write path, not here).

const NAME_MAX = 120;
const ASSET_TAG_MAX = 80;
const QUANTITY_MAX = 1_000_000;

export type EquipmentTracking = "unit" | "bulk";

export interface ValidatedEquipmentItem {
  name: string;
  tracking: EquipmentTracking;
  quantity: number | null;
  assetTag: string | null;
}

export type ValidateEquipmentItemResult =
  | { ok: true; value: ValidatedEquipmentItem }
  | { ok: false; error: string };

export function validateEquipmentItem(input: {
  name: string;
  tracking: string;
  quantity: number | null;
  assetTag: string;
}): ValidateEquipmentItemResult {
  if (input.tracking !== "unit" && input.tracking !== "bulk") {
    return { ok: false, error: "ประเภทการติดตามไม่ถูกต้อง" };
  }
  const tracking: EquipmentTracking = input.tracking;

  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, error: "กรุณาระบุชื่ออุปกรณ์" };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, error: `ชื่ออุปกรณ์ต้องไม่เกิน ${NAME_MAX} ตัวอักษร` };
  }

  const assetTag = input.assetTag.trim();

  if (tracking === "bulk") {
    if (assetTag.length > 0) {
      return { ok: false, error: "อุปกรณ์แบบจำนวนมากไม่ต้องมีรหัสครุภัณฑ์" };
    }
    if (input.quantity === null || !Number.isInteger(input.quantity) || input.quantity < 1) {
      return { ok: false, error: "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป" };
    }
    if (input.quantity > QUANTITY_MAX) {
      return { ok: false, error: "จำนวนมากเกินไป" };
    }
    return {
      ok: true,
      value: { name, tracking, quantity: input.quantity, assetTag: null },
    };
  }

  // tracking === "unit"
  if (input.quantity !== null) {
    return { ok: false, error: "อุปกรณ์แบบรายชิ้นไม่ต้องระบุจำนวน" };
  }
  if (assetTag.length > ASSET_TAG_MAX) {
    return { ok: false, error: `รหัสครุภัณฑ์ต้องไม่เกิน ${ASSET_TAG_MAX} ตัวอักษร` };
  }
  return {
    ok: true,
    value: {
      name,
      tracking,
      quantity: null,
      assetTag: assetTag.length === 0 ? null : assetTag,
    },
  };
}
