"use client";

// Spec 361 U8 — the หน่วยนับ curation board.
//
// Top half: the managed vocabulary (`catalog_units`) with how many live items
// carry each unit, so retiring one is an informed decision rather than a guess.
// Bottom half: the strings that reached items through the `อื่น ๆ (ระบุเอง)`
// escape hatch without being managed — each with its item count and a one-tap
// promote, which is how the list gets cleaned without a data migration.
//
// 'use client': the add/edit sheets are stateful. Writes go through the spec-223
// SECURITY DEFINER RPCs (create/update/set_catalog_unit_active) via the server
// actions — catalog_units has no INSERT/UPDATE grant, and the RPC gate
// (project_manager · super_admin · procurement · procurement_manager ·
// project_director) matches this page's own requireRole, so no control here can
// render for someone the DB will refuse.

import { useState } from "react";

import type { ManagedUnitUsage, OffListUnit } from "@/lib/catalog/units-curation";
import { UNIT_INACTIVE_LABEL } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY_COMPACT, CARD } from "@/lib/ui/classes";
import { UnitSheet } from "./unit-sheet";

// The usage number counts ACTIVE catalog_items only. Other tables (boq_line,
// purchase_requests, the stock ledger) also store a free-text unit, so the copy
// says ทะเบียนวัสดุ rather than claiming a firm-wide "in use" count.
export const UNITS_ALL_MANAGED_NOTE = "ทุกหน่วยในทะเบียนวัสดุอยู่ในรายการแล้ว";
export const UNIT_PROMOTE_LABEL = "เพิ่มเป็นหน่วยนับ";

export function UnitsBoard({
  managed,
  offList,
}: {
  managed: readonly ManagedUnitUsage[];
  offList: readonly OffListUnit[];
}) {
  // The unit being edited, or a code pre-filled from an off-list promote.
  const [editing, setEditing] = useState<ManagedUnitUsage | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">
            หน่วยนับที่ใช้ได้ <span className="text-ink-muted">({managed.length})</span>
          </h2>
          <button
            type="button"
            onClick={() => setPromoting("")}
            className={BUTTON_SECONDARY_COMPACT}
          >
            เพิ่มหน่วยนับ
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {managed.map((unit) => (
            <li
              key={unit.code}
              data-testid={`unit-row-${unit.code}`}
              className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
            >
              <span className="text-ink text-body min-w-0 flex-1 font-medium">
                {unit.displayName}
              </span>
              <span className="text-ink-secondary text-meta">
                ในทะเบียนวัสดุ {unit.usage} รายการ
              </span>
              {unit.isActive ? null : (
                <span className="text-ink-muted text-meta">{UNIT_INACTIVE_LABEL}</span>
              )}
              <button
                type="button"
                onClick={() => setEditing(unit)}
                className={BUTTON_SECONDARY_COMPACT}
                aria-label={`แก้ไข ${unit.displayName}`}
              >
                แก้ไข
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-meta text-ink-secondary font-semibold">
          หน่วยที่พิมพ์เอง — ยังไม่อยู่ในรายการ
        </h2>
        {offList.length === 0 ? (
          <p className="text-ink-secondary text-body">{UNITS_ALL_MANAGED_NOTE}</p>
        ) : (
          <>
            <p className="text-ink-secondary text-meta">
              หน่วยเหล่านี้ถูกพิมพ์ไว้ในรายการวัสดุโดยตรง —
              เพิ่มเข้ารายการเพื่อให้ครั้งต่อไปเลือกได้
            </p>
            <ul className="flex flex-col gap-2">
              {offList.map((row) => (
                <li
                  key={row.unit}
                  data-testid={`offlist-row-${row.unit}`}
                  className={`${CARD} flex items-center gap-3`}
                >
                  <span className="text-ink text-body min-w-0 flex-1 font-medium">{row.unit}</span>
                  <span className="text-ink-secondary text-meta">{row.usage} รายการ</span>
                  <button
                    type="button"
                    onClick={() => setPromoting(row.unit)}
                    className={BUTTON_SECONDARY_COMPACT}
                    aria-label={`${UNIT_PROMOTE_LABEL} ${row.unit}`}
                  >
                    {UNIT_PROMOTE_LABEL}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {promoting !== null && (
        <UnitSheet mode="create" initialCode={promoting} onClose={() => setPromoting(null)} />
      )}
      {editing !== null && (
        <UnitSheet mode="edit" unit={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
