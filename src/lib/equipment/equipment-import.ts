// Spec 367 U3 — the equipment CSV importer (pure parse + validate, NO IO).
//
// This is the other half of equipment-export.ts. The operator's workflow is
// "download the CSV → fill the blanks in Excel/Sheets → paste it back", so the
// two share ONE column contract and the round-trip is pinned by test. There is
// deliberately no separate template artifact to drift from.
//
// Two refusals are the point of this module, not incidental strictness:
//
//   1. **Taxonomy is resolved, never invented.** An unknown category/owner/
//      supplier NAME is an error, not an auto-create. Auto-creating is exactly
//      how `งานวัสดุพื้นฐานโครงสร้าง` got into the category list (spec 367 §1.4)
//      — a typo becomes a permanent row nobody notices until an audit.
//   2. **An unknown id is an error, not an insert.** A filled id that matches
//      nothing means the operator edited the key column or pasted from another
//      environment; inserting would silently duplicate a physical asset.
//
// MONEY IS READ-ONLY ON IMPORT, for EVERY audience — gate-checked against the
// actual write path, not assumed from the spec. `daily_rate` is writable only
// through the SECURITY DEFINER `set_equipment_daily_rate` RPC (where the gate
// and the audit row live), `acquisition_cost` has no write path in the app at
// all, and neither — nor `acquired_at` — carries an authenticated grant, so an
// RLS-client write would 42501. A filled money cell is therefore refused with a
// message, never silently dropped: accepting the file and writing everything
// except the prices is the silent-success failure the operator would only find
// months later. All 64 rows are blank today, so the ordinary round trip is
// unaffected. **Loading cost/rate by CSV needs its own unit** (a DEFINER RPC),
// recorded in spec 367 §10.
//
// Separately, the HEADER-level gate still mirrors the export: a non-money
// audience gets a file WITHOUT those columns, so receiving them from that
// audience means the file is not theirs, and the whole file is refused.
//
// Errors are collected for EVERY bad row (never first-failure), because the
// operator is editing 64 rows offline and wants one complete list to fix.

import Papa from "papaparse";
import {
  EQUIPMENT_CONDITION_LABEL,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_TRACKING_LABEL,
} from "@/lib/i18n/labels";
import { validateEquipmentItem } from "@/lib/equipment/validate-equipment-item";
import { detectPasteDelimiter as detectDelimiter } from "@/lib/equipment/paste-delimiter";
import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

/** Column headers, matching equipment-export.ts exactly. */
const COL = {
  id: "รหัสอ้างอิง",
  name: "ชื่อ",
  category: "หมวดหมู่",
  brand: "ยี่ห้อ",
  model: "รุ่น",
  serialNo: "หมายเลขเครื่อง",
  assetTag: "ป้ายทรัพย์สิน",
  tracking: "การติดตาม",
  quantity: "จำนวน",
  condition: "สภาพ",
  status: "สถานะ",
  owner: "เจ้าของ",
  supplier: "ผู้ขาย",
  acquiredAt: "วันที่ได้มา",
  cost: "ราคาทุน",
  rate: "ค่าเช่า/วัน",
  description: "รายละเอียด",
  /** READ-ONLY — derived from equipment_movements. Parsed away, never written. */
  location: "ที่ตั้งปัจจุบัน",
  /** READ-ONLY — images cannot ride in a CSV (spec 367 §7). */
  hasImage: "มีรูป",
} as const;

export interface EquipmentImportContext {
  categoriesByName: ReadonlyMap<string, string>;
  ownersByName: ReadonlyMap<string, string>;
  /** Every equipment_items.id currently visible to the importer. */
  existingIds: ReadonlySet<string>;
  /** BACK_OFFICE_ROLES. Mirrors the export's `includeMoney`. */
  allowMoney: boolean;
}

export interface ParsedEquipmentRow {
  kind: "insert" | "update";
  /** null for an insert. */
  id: string | null;
  name: string;
  categoryId: string;
  ownerId: string;
  // NOTE: no supplierId — spec 275 mirrors it from ownerId at write time, so
  // the caller must set supplier_id = ownerId rather than trust a column.
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  assetTag: string | null;
  tracking: Enums["equipment_tracking"];
  quantity: number | null;
  condition: Enums["equipment_condition"] | null;
  status: Enums["equipment_status"];
  description: string | null;
  // NOTE: acquiredAt / acquisitionCost / dailyRate are deliberately ABSENT.
  // None of the three is writable by this path (no authenticated grant;
  // daily_rate goes through set_equipment_daily_rate, acquisition_cost has no
  // write path at all), so carrying them in the row shape would invite a caller
  // to write something that 42501s. They are refused at parse time instead.
}

export interface EquipmentImportResult {
  rows: ParsedEquipmentRow[];
  errors: string[];
  inserts: number;
  updates: number;
}

/** Thai label → enum value. Built by inverting the labels.ts SSOT. */
function invert<T extends string>(map: Record<T, string>): Map<string, T> {
  return new Map((Object.entries(map) as [T, string][]).map(([value, label]) => [label, value]));
}
const TRACKING_BY_LABEL = invert(EQUIPMENT_TRACKING_LABEL);
const CONDITION_BY_LABEL = invert(EQUIPMENT_CONDITION_LABEL);
const STATUS_BY_LABEL = invert(EQUIPMENT_STATUS_LABEL);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Spec 367 U3 — see the money block in the row loop. One message for both
// columns so the wording cannot drift between them.
const MONEY_READ_ONLY = (col: string): string =>
  `คอลัมน์ "${col}" ยังแก้ไขผ่านการนำเข้าไม่ได้ — กรุณาเว้นว่างไว้ แล้วแก้ไขในหน้าอุปกรณ์โดยตรง`;

// Spec 367 §13 — the sniff moved to `paste-delimiter.ts` when the bulk-add paste
// needed the same rule; re-exported under the old local name so this file's call
// site and its tests are unchanged. One rule, one home.

/** Blank → null. A number → itself. Anything else → an error for the caller. */
function parseOptionalNumber(raw: string): { ok: true; value: number | null } | { ok: false } {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  // Tolerate thousands separators typed by a spreadsheet, nothing else.
  const cleaned = v.replaceAll(",", "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false };
  return { ok: true, value: Number(cleaned) };
}

export function parseEquipmentImport(
  text: string,
  ctx: EquipmentImportContext,
): EquipmentImportResult {
  const errors: string[] = [];
  const rows: ParsedEquipmentRow[] = [];
  const seenIds = new Set<string>();

  const parsed = Papa.parse<Record<string, string | undefined>>(text, {
    header: true,
    delimiter: detectDelimiter(text),
    skipEmptyLines: true,
    // The exporter emits a UTF-8 BOM; without stripping it the FIRST header cell
    // would be "﻿รหัสอ้างอิง" and every id would read as missing.
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });

  for (const e of parsed.errors) {
    if (e.code === "TooManyFields" || e.code === "TooFewFields") continue;
    const rowNum = typeof e.row === "number" ? e.row + 1 : "?";
    errors.push(`แถว ${rowNum}: อ่านไฟล์ไม่ได้ — ${e.message}`);
  }

  // The money gate, checked ONCE on the header rather than per row: receiving a
  // money column from a non-money audience means the file did not come from
  // their own export, so the whole file is refused rather than silently
  // dropping the columns (which would look like a successful import).
  const headers = parsed.meta.fields ?? [];
  if (!ctx.allowMoney && headers.some((h) => h === COL.cost || h === COL.rate)) {
    errors.push(
      `ไฟล์นี้มีคอลัมน์ราคา (${COL.cost}/${COL.rate}) ซึ่งบัญชีของคุณไม่มีสิทธิ์แก้ไข — กรุณาใช้ไฟล์ที่ดาวน์โหลดจากบัญชีนี้`,
    );
    return { rows: [], errors, inserts: 0, updates: 0 };
  }

  parsed.data.forEach((raw, i) => {
    const rowNum = i + 1;
    const cell = (key: string): string => (raw[key] ?? "").trim();
    const bad = (msg: string): void => {
      errors.push(`แถว ${rowNum}: ${msg}`);
    };
    const before = errors.length;

    const id = cell(COL.id);
    // Spec 385 U4 — the INSERT arm is retired: an instance is born by picking
    // from the ทะเบียน (U2), never from a spreadsheet row, and the NOT NULL FK
    // (mig 075891) would refuse a file-born row anyway. This file remains the
    // bulk EDITOR for rows that exist (the export → edit → import round trip).
    let kind: "insert" | "update" = "insert";
    if (id === "") {
      bad(
        "ไม่มีรหัสอ้างอิง — ไฟล์นี้ใช้แก้ไขรายการเดิมเท่านั้น เพิ่มเครื่องใหม่ผ่านทะเบียนบนหน้าอุปกรณ์",
      );
    } else if (!ctx.existingIds.has(id)) {
      bad(`ไม่พบรหัสอ้างอิง ${id} — แก้ไขได้เฉพาะรายการที่มีอยู่แล้ว`);
    } else if (seenIds.has(id)) {
      bad(`รหัสอ้างอิง ${id} ซ้ำในไฟล์เดียวกัน`);
    } else {
      seenIds.add(id);
      kind = "update";
    }

    const categoryName = cell(COL.category);
    const categoryId = ctx.categoriesByName.get(categoryName);
    if (!categoryId) bad(`ไม่รู้จักหมวดหมู่ "${categoryName}" — ต้องสร้างหมวดหมู่ในระบบก่อน`);

    const ownerName = cell(COL.owner);
    const ownerId = ctx.ownersByName.get(ownerName);
    if (!ownerId) bad(`ไม่รู้จักเจ้าของ "${ownerName}" — ต้องสร้างเจ้าของในระบบก่อน`);

    // ผู้ขาย is NOT independently settable. Spec 275 id-mirrors an equipment
    // owner into `suppliers` and the write path sets `supplier_id = owner_id` to
    // keep the GL-party edge in step — so a supplier that differs from the owner
    // would be silently overwritten on save. Refuse the drift instead of
    // accepting an edit that cannot land. (Equal values round-trip fine: the
    // exporter emits both from the same mirrored row, which is why all 64 live
    // rows show the same name in both columns.)
    const supplierName = cell(COL.supplier);
    if (supplierName !== "" && supplierName !== ownerName) {
      bad(
        `"${COL.supplier}" ต้องตรงกับ "${COL.owner}" (ระบบผูกผู้ขายกับเจ้าของอุปกรณ์อัตโนมัติ) — กรุณาเว้นว่างหรือใส่ให้ตรงกัน`,
      );
    }

    const trackingLabel = cell(COL.tracking);
    const tracking = TRACKING_BY_LABEL.get(trackingLabel);
    if (!tracking) bad(`ไม่รู้จักการติดตาม "${trackingLabel}"`);

    const statusLabel = cell(COL.status);
    const status = STATUS_BY_LABEL.get(statusLabel);
    if (!status) bad(`ไม่รู้จักสถานะ "${statusLabel}"`);

    const conditionLabel = cell(COL.condition);
    let condition: Enums["equipment_condition"] | null = null;
    if (conditionLabel !== "") {
      condition = CONDITION_BY_LABEL.get(conditionLabel) ?? null;
      if (!condition) bad(`ไม่รู้จักสภาพ "${conditionLabel}"`);
    }

    const qty = parseOptionalNumber(cell(COL.quantity));
    if (!qty.ok) bad(`จำนวนไม่ใช่ตัวเลข`);

    // `acquired_at` carries no authenticated grant either (U1 granted only the
    // six non-money columns), so it is read-only on import for the same reason.
    const acquiredAt = cell(COL.acquiredAt);
    if (acquiredAt !== "") {
      if (!ISO_DATE.test(acquiredAt))
        bad(`วันที่ได้มาต้องเป็นรูปแบบ ปี-เดือน-วัน (เช่น 2025-03-04)`);
      else bad(MONEY_READ_ONLY(COL.acquiredAt));
    }

    // MONEY IS READ-ONLY ON IMPORT (spec 367 U3, gate-checked against the write
    // path). `daily_rate` is writable only through the SECURITY DEFINER
    // `set_equipment_daily_rate` RPC — where the real gate and the audit row
    // live — and `acquisition_cost` has NO write path in the app at all. Neither
    // carries an authenticated grant, so an RLS-client write would 42501.
    //
    // A filled money cell is therefore REFUSED, loudly. The alternative —
    // accepting the file and writing everything except the prices — is the
    // silent-success failure: the operator fills 64 costs, sees "64 updated",
    // and the numbers are simply gone. Today all 64 are blank, so the ordinary
    // round trip is unaffected; the day someone uses the file for its actual
    // purpose they get told why instead of losing the work.
    const cost = parseOptionalNumber(cell(COL.cost));
    if (!cost.ok) bad(`ราคาทุนไม่ใช่ตัวเลข`);
    else if (cost.value !== null) bad(MONEY_READ_ONLY(COL.cost));
    const rate = parseOptionalNumber(cell(COL.rate));
    if (!rate.ok) bad(`ค่าเช่า/วันไม่ใช่ตัวเลข`);
    else if (rate.value !== null) bad(MONEY_READ_ONLY(COL.rate));

    // Reuse the form's validator so the file and the UI enforce ONE set of
    // unit/bulk invariants (the DB CHECK re-enforces them a third time).
    const assetTag = cell(COL.assetTag);
    if (tracking) {
      const check = validateEquipmentItem({
        name: cell(COL.name),
        tracking,
        quantity: qty.ok ? qty.value : null,
        assetTag,
      });
      if (!check.ok) bad(check.error);
    }

    if (errors.length !== before) return; // this row contributed at least one error

    rows.push({
      kind,
      id: kind === "update" ? id : null,
      name: cell(COL.name),
      categoryId: categoryId!,
      ownerId: ownerId!,
      brand: cell(COL.brand) || null,
      model: cell(COL.model) || null,
      serialNo: cell(COL.serialNo) || null,
      assetTag: assetTag || null,
      tracking: tracking!,
      quantity: qty.ok ? qty.value : null,
      condition,
      status: status!,
      description: cell(COL.description) || null,
    });
  });

  // A file whose rows are not all clean writes NOTHING. A partial import over 64
  // rows leaves the operator unable to tell which half landed.
  if (errors.length > 0) {
    return { rows: [], errors, inserts: 0, updates: 0 };
  }

  return {
    rows,
    errors,
    inserts: rows.filter((r) => r.kind === "insert").length,
    updates: rows.filter((r) => r.kind === "update").length,
  };
}
