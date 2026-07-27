// Spec 368 U1 — เครื่องมือและอุปกรณ์ on the project store page.
//
// Operator, 2026-07-28: "Handle view in store, separate equipments from
// materials." The store's own list is stock (`catalog_items` — 398 stocked item
// types at โพธิ์ทอง); this section is the DURABLE tools standing beside it, read
// from `equipment_items` + the movement log.
//
// Deliberately read-only. Moving a tool is a movement, and that already has a
// home on /equipment; duplicating the write here would put two different write
// paths on one fact. This section answers "what tools are on this site?", which
// today has no answer anywhere.
//
// Renders NOTHING when the set is empty, so a project with no tools recorded —
// and a viewer whose RLS cannot read equipment_items — gets no empty box.

import { CARD } from "@/lib/ui/classes";
import { EQUIPMENT_CONDITION_LABEL, EQUIPMENT_STATUS_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type Enums = Database["public"]["Enums"];

export interface StoreEquipmentRow {
  id: string;
  name: string;
  categoryName: string;
  assetTag: string | null;
  status: Enums["equipment_status"];
  condition: Enums["equipment_condition"] | null;
}

export function StoreEquipmentSection({ items }: { items: readonly StoreEquipmentRow[] }) {
  if (items.length === 0) return null;

  // Grouped by category, matching the วัสดุ list's `label (n)` section idiom
  // (spec 362) so the two halves of the store read as one screen.
  const byCategory = new Map<string, StoreEquipmentRow[]>();
  for (const it of items) {
    const bucket = byCategory.get(it.categoryName);
    if (bucket) bucket.push(it);
    else byCategory.set(it.categoryName, [it]);
  }
  const groups = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], "th"));

  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-ink text-sm font-semibold">เครื่องมือและอุปกรณ์</p>
        <p className="text-ink-secondary text-meta">{items.length} รายการ</p>
      </div>
      <p className="text-ink-secondary mt-1 text-xs">
        อุปกรณ์ที่บันทึกว่าอยู่ที่โครงการนี้ — แยกจากวัสดุในคลัง ย้ายอุปกรณ์ได้ที่หน้าอุปกรณ์
      </p>

      {groups.map(([category, rows]) => (
        <div key={category} className="mt-3">
          <p className="text-ink-secondary text-meta font-medium">
            {category} ({rows.length})
          </p>
          <ul className="mt-1 flex flex-col">
            {rows
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, "th"))
              .map((it) => (
                <li key={it.id} className="border-edge border-b py-2 last:border-b-0">
                  <p className="text-ink text-sm">{it.name}</p>
                  <p className="text-ink-secondary text-meta">
                    {EQUIPMENT_STATUS_LABEL[it.status]}
                    {it.condition ? ` · ${EQUIPMENT_CONDITION_LABEL[it.condition]}` : ""}
                    {it.assetTag ? ` · ${it.assetTag}` : ""}
                  </p>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
