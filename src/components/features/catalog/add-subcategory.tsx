"use client";

// Spec 219 U2 — "add subcategory" on the /catalog/subcategories manage screen.
// Thin sheet: back-office picks a main category, a 2-digit code and a name. The
// create_catalog_subcategory SECURITY DEFINER RPC carries the role gate +
// (category, code) uniqueness; catalog_subcategories has no INSERT grant.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { createCatalogSubcategory } from "@/app/catalog/actions";
import { ITEM_CATEGORY_LABEL, CATALOG_SUBCATEGORY_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

type ItemCategory = Database["public"]["Enums"]["item_category"];
const CATEGORIES = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];
const CODE_RE = /^[0-9]{2}$/;

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function AddSubcategory() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function reset() {
    setCategory("");
    setCode("");
    setName("");
    setSortOrder("");
    setError(null);
  }

  function close() {
    reset();
    setOpen(false);
  }

  const canSubmit = category !== "" && CODE_RE.test(code) && name.trim() !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createCatalogSubcategory({
        category,
        code,
        name: name.trim(),
        sortOrder: sortOrder.trim() === "" ? 0 : Number(sortOrder),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        เพิ่มหมวดย่อย
      </button>

      <BottomSheet open={open} title="เพิ่มหมวดย่อย" onClose={close}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sc-category" className={LABEL}>
              หมวดหมู่หลัก
            </label>
            <select
              id="sc-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">เลือกหมวดหมู่หลัก</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ITEM_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sc-code" className={LABEL}>
              รหัสหมวดย่อย (2 หลัก)
            </label>
            <input
              id="sc-code"
              type="text"
              inputMode="numeric"
              value={code}
              maxLength={2}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น 01"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sc-name" className={LABEL}>
              ชื่อ{CATALOG_SUBCATEGORY_LABEL}
            </label>
            <input
              id="sc-name"
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น วัสดุโครงสร้าง"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sc-order" className={LABEL}>
              ลำดับ (ถ้ามี)
            </label>
            <input
              id="sc-order"
              type="number"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="0"
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
