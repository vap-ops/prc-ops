"use client";

// Spec 221 U3 — per-row edit / deactivate of a MAIN category on the /catalog
// taxonomy manage screen. Unlike a subcategory, the main-category 2-digit code
// IS editable (recode) — items key on category_id, not the code. "เอาออก" sets
// is_active=false (reversible). update_catalog_category carries the gate.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { updateCatalogCategory } from "@/app/catalog/actions";
import { CATALOG_CATEGORY_LABEL } from "@/lib/i18n/labels";

export type Category = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

const CODE_RE = /^[0-9]{2}$/;
const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function EditCategory({ category }: { category: Category }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(category.code);
  const [name, setName] = useState(category.name);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function close() {
    setCode(category.code);
    setName(category.name);
    setSortOrder(String(category.sortOrder));
    setError(null);
    setOpen(false);
  }

  const canSubmit = CODE_RE.test(code) && name.trim() !== "" && !submitting;

  function run(isActive: boolean) {
    setError(null);
    startSubmit(async () => {
      const result = await updateCatalogCategory({
        id: category.id,
        code,
        name: name.trim(),
        sortOrder: sortOrder.trim() === "" ? 0 : Number(sortOrder),
        isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    run(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-action focus-visible:ring-action inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2"
      >
        <Pencil aria-hidden className="size-4" />
        แก้ไข
      </button>

      <BottomSheet open={open} title={`แก้ไข${CATALOG_CATEGORY_LABEL}`} onClose={close}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cce-code" className={LABEL}>
              รหัส{CATALOG_CATEGORY_LABEL} (2 หลัก)
            </label>
            <input
              id="cce-code"
              type="text"
              inputMode="numeric"
              value={code}
              maxLength={2}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cce-name" className={LABEL}>
              ชื่อ{CATALOG_CATEGORY_LABEL}
            </label>
            <input
              id="cce-name"
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cce-order" className={LABEL}>
              ลำดับ
            </label>
            <input
              id="cce-order"
              type="number"
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => run(false)}
              disabled={submitting}
              className={BUTTON_SECONDARY}
            >
              {submitting ? "กำลังเอาออก…" : "เอาออก"}
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={close} className={BUTTON_SECONDARY}>
                ยกเลิก
              </button>
              <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
                {submitting ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
