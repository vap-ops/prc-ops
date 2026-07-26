"use client";

// Spec 361 U6 — one row of the หมวดอุปกรณ์ list, with rename in place.
//
// Categories have been add-only since spec 141 (`createEquipmentCategory` had no
// sibling), so a typo'd name was permanent and the ข้อมูลหลัก hub had to say so.
// The DB was already ahead: the live UPDATE policy admits the same five roles as
// the insert and the grant covers exactly (name, parent_id) — so this is UI, not
// schema. Retiring a category still needs an `is_active` column and is NOT here.
//
// The item count rides along because renaming a category with equipment in it is
// a different decision from renaming an empty one.
//
// 'use client': inline edit state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { renameEquipmentCategory } from "@/app/equipment/actions";
import { BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY_COMPACT, FIELD_STACKED } from "@/lib/ui/classes";

export function EditCategoryRow({
  category,
  itemCount,
}: {
  category: { id: string; name: string };
  itemCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, startWrite] = useTransition();

  const trimmed = name.trim();
  const canSave = trimmed !== "" && trimmed !== category.name && !busy;

  function save() {
    if (!canSave) return;
    setError(null);
    startWrite(async () => {
      const result = await renameEquipmentCategory({ id: category.id, name: trimmed });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <li className="border-edge flex flex-col gap-2 border-b py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="text-ink text-body min-w-0 flex-1 font-medium">{category.name}</span>
        <span className="text-ink-secondary text-meta">{itemCount} รายการ</span>
        {open ? null : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={BUTTON_SECONDARY_COMPACT}
            aria-label={`เปลี่ยนชื่อ ${category.name}`}
          >
            เปลี่ยนชื่อ
          </button>
        )}
      </div>

      {open && (
        <div>
          <label className="text-ink-secondary block text-sm">
            ชื่อหมวดหมู่
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className={FIELD_STACKED}
            />
          </label>
          {error ? (
            <p role="alert" className="text-danger mt-2 text-sm">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className={BUTTON_PRIMARY_COMPACT}
            >
              {busy ? "กำลังบันทึก…" : "บันทึก"}
            </button>
            <button
              type="button"
              onClick={() => {
                setName(category.name);
                setError(null);
                setOpen(false);
              }}
              className={BUTTON_SECONDARY_COMPACT}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
