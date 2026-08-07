// Spec 367 §13 — the bulk add paste (pure parse + validate, NO IO).
//
// The registry is filled by hand and the only door is the add sheet, one trip
// per machine. The last physical count was 68 units across 63 SKU rows, so the
// procurement hand-off costs ~68 trips before anyone types a serial number.
//
// ⭐ This does NOT reverse spec 385 U4. The export/import round trip stays
// EDIT-ONLY and `equipment-import.ts` is untouched; here the FIRST column is the
// ทะเบียน SKU name, resolved against `equipment_catalog_items` and NEVER created.
// So an instance is still born from the catalog — the NOT NULL
// `equipment_catalog_item_id` (mig 075891) is satisfied by construction rather
// than by a new free-text escape hatch. Two doors, one birth channel.
//
// ⚠️ `จำนวน` carries two real-world meanings, decided by the SKU's tracking: for
// a unit SKU it is HOW MANY MACHINES to create, for a bulk SKU it is the ONE
// row's quantity (the partial unique index allows a single bulk row per SKU).
// That is the collapsed-semantics class, and the mitigation is that every row
// carries its `effect` in words for the preview — nothing is written until the
// operator has read what each line will do.
//
// Errors are collected for EVERY bad row (never first-failure): the sheet is
// assembled offline and the operator wants one complete list to fix.

import Papa from "papaparse";

import { EQUIPMENT_MOVEMENT_KIND_LABEL } from "@/lib/i18n/labels";
import { nextUnitName } from "@/lib/equipment/catalog-pick";
import { STORE_LOCATION } from "@/lib/equipment/initial-location";
import { detectPasteDelimiter } from "@/lib/equipment/paste-delimiter";
import type { Database } from "@/lib/db/database.types";

type Tracking = Database["public"]["Enums"]["equipment_tracking"];

/** Column headers. Short on purpose — this paste creates rows, it does not finish them. */
const COL = {
  sku: "ทะเบียน",
  quantity: "จำนวน",
  owner: "เจ้าของ",
  location: "ที่ตั้ง",
} as const;

/** `equipment_items.name` is capped at 120 by the same CHECK the add sheet meets. */
const NAME_MAX = 120;

export interface BulkAddSku {
  id: string;
  categoryId: string;
  brand: string | null;
  model: string | null;
  defaultTracking: Tracking;
  isActive: boolean;
  /** Live instance count — drives both the No.<n+1> numbering and the bulk one-row rule. */
  instanceCount: number;
}

export interface BulkAddContext {
  skusByName: ReadonlyMap<string, BulkAddSku>;
  ownersByName: ReadonlyMap<string, string>;
  /** equipment_owners.is_default. null = unseeded, which asks rather than guesses. */
  defaultOwnerId: string | null;
  projectsByName: ReadonlyMap<string, string>;
}

export interface BulkAddRow {
  catalogItemId: string;
  skuName: string;
  categoryId: string;
  brand: string | null;
  model: string | null;
  tracking: Tracking;
  /** How many `equipment_items` rows this line writes. Always 1 for bulk. */
  instances: number;
  /** The bulk row's quantity; null for unit rows. */
  quantity: number | null;
  /** The first No.<n> this line will mint; null for bulk. */
  firstNumber: number | null;
  ownerId: string;
  /** STORE_LOCATION or a project id — the shape `resolveInitialMovement` consumes. */
  location: string;
  /** What this line DOES, in words, for the preview. See the จำนวน note above. */
  effect: string;
}

export interface BulkAddParseResult {
  rows: BulkAddRow[];
  errors: string[];
  /** Total `equipment_items` rows the file would write. */
  unitsToCreate: number;
}

function parseCount(raw: string): number | null {
  const v = raw.trim().replaceAll(",", "");
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function parseBulkEquipmentAdd(text: string, ctx: BulkAddContext): BulkAddParseResult {
  const errors: string[] = [];
  const rows: BulkAddRow[] = [];
  const seenSkus = new Set<string>();

  const parsed = Papa.parse<Record<string, string | undefined>>(text, {
    header: true,
    delimiter: detectPasteDelimiter(text),
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, "").trim(),
  });

  for (const e of parsed.errors) {
    if (e.code === "TooManyFields" || e.code === "TooFewFields") continue;
    const rowNum = typeof e.row === "number" ? e.row + 1 : "?";
    errors.push(`แถว ${rowNum}: อ่านไฟล์ไม่ได้ — ${e.message}`);
  }

  if (parsed.data.length === 0) {
    errors.push(`ไม่พบข้อมูล — วางทั้งตารางรวมหัวตาราง (${COL.sku} · ${COL.quantity})`);
    return { rows: [], errors, unitsToCreate: 0 };
  }

  parsed.data.forEach((raw, i) => {
    const rowNum = i + 1;
    const cell = (key: string): string => (raw[key] ?? "").trim();
    const bad = (msg: string): void => {
      errors.push(`แถว ${rowNum}: ${msg}`);
    };
    const before = errors.length;

    const skuName = cell(COL.sku);
    const sku = ctx.skusByName.get(skuName);
    if (skuName === "") {
      bad(`ไม่มีชื่อรายการในคอลัมน์ "${COL.sku}"`);
    } else if (!sku) {
      bad(`ไม่พบ "${skuName}" ในทะเบียนเครื่องมือ — ต้องเพิ่มเข้าทะเบียนก่อน`);
    } else if (!sku.isActive) {
      bad(`"${skuName}" ถูกปิดใช้งานในทะเบียนแล้ว — เปิดใช้งานก่อนจึงจะเพิ่มเครื่องได้`);
    } else if (seenSkus.has(skuName)) {
      // Two lines for one SKU would both number from the same live count, so the
      // second would collide on names the first has already taken.
      bad(`"${skuName}" ซ้ำในไฟล์เดียวกัน — รวมเป็นแถวเดียวแล้วใส่จำนวนรวม`);
    } else {
      seenSkus.add(skuName);
    }

    const count = parseCount(cell(COL.quantity));
    if (count === null) {
      bad(`"${COL.quantity}" ต้องเป็นจำนวนเต็มอย่างน้อย 1`);
    }

    const ownerName = cell(COL.owner);
    let ownerId: string | null = null;
    if (ownerName === "") {
      ownerId = ctx.defaultOwnerId;
      if (!ownerId) {
        bad(`ไม่มี "${COL.owner}" เริ่มต้นในระบบ — กรุณาระบุเจ้าของในทุกแถว`);
      }
    } else {
      ownerId = ctx.ownersByName.get(ownerName) ?? null;
      if (!ownerId) bad(`ไม่รู้จักเจ้าของ "${ownerName}" — ต้องสร้างเจ้าของในระบบก่อน`);
    }

    const locationName = cell(COL.location);
    let location: string | null = null;
    if (locationName === "") {
      location = STORE_LOCATION;
    } else {
      location = ctx.projectsByName.get(locationName) ?? null;
      if (!location) bad(`ไม่รู้จักที่ตั้ง "${locationName}" — เว้นว่างไว้ถ้าอยู่ที่คลัง`);
    }

    // The bulk one-row rule (mig 075891's partial unique index) — refused here so
    // the file meets the app's own message instead of a 23505 mid-commit.
    if (sku && sku.isActive && sku.defaultTracking === "bulk" && sku.instanceCount > 0) {
      bad(`"${skuName}" มีแถวอยู่แล้ว — แก้ไขจำนวนที่แถวเดิมแทนการเพิ่มใหม่`);
    }

    // The derived name carries a " No.<n>" suffix the operator cannot edit, so
    // the cap is checked against the LAST number this line would mint.
    if (sku && sku.isActive && sku.defaultTracking === "unit" && count !== null) {
      const longest = nextUnitName(skuName, sku.instanceCount + count - 1);
      if (longest.length > NAME_MAX) {
        bad(`ชื่อ "${skuName}" ยาวเกินไปสำหรับตั้งหมายเลขหน่วย — ย่อชื่อในทะเบียนก่อน`);
      }
    }

    if (errors.length !== before) return;
    // Narrowing only: every one of these was checked above.
    if (!sku || count === null || !ownerId || !location) return;

    const where =
      location === STORE_LOCATION
        ? EQUIPMENT_MOVEMENT_KIND_LABEL.received
        : `${EQUIPMENT_MOVEMENT_KIND_LABEL.deployed}: ${locationName}`;

    if (sku.defaultTracking === "unit") {
      const first = sku.instanceCount + 1;
      const last = sku.instanceCount + count;
      const names =
        count === 1
          ? nextUnitName(skuName, sku.instanceCount)
          : `${nextUnitName(skuName, sku.instanceCount)}–No.${last}`;
      rows.push({
        catalogItemId: sku.id,
        skuName,
        categoryId: sku.categoryId,
        brand: sku.brand,
        model: sku.model,
        tracking: "unit",
        instances: count,
        quantity: null,
        firstNumber: first,
        ownerId,
        location,
        effect: `สร้าง ${count} เครื่อง (${names}) · ${where}`,
      });
    } else {
      rows.push({
        catalogItemId: sku.id,
        skuName,
        categoryId: sku.categoryId,
        brand: sku.brand,
        model: sku.model,
        tracking: "bulk",
        instances: 1,
        quantity: count,
        firstNumber: null,
        ownerId,
        location,
        effect: `1 แถว จำนวน ${count} · ${where}`,
      });
    }
  });

  // All-or-nothing at the PARSER, not just by caller convention: any bad row and
  // there is nothing to write at all. A future caller that reads `rows` without
  // checking `errors` would otherwise half-load the registry from a file the
  // operator was told to fix — and the good rows of a rejected file are exactly
  // the ones they will paste again after fixing the bad ones.
  if (errors.length > 0) return { rows: [], errors, unitsToCreate: 0 };

  return {
    rows,
    errors,
    unitsToCreate: rows.reduce((sum, r) => sum + r.instances, 0),
  };
}
