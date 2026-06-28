"use client";

// Spec 219 U2 — per-row edit / deactivate on the /catalog/subcategories manage
// screen. The 2-digit code is immutable (item FKs key on the row); name +
// sort_order are editable; "เอาออก" sets is_active=false (reversible soft
// delete, mirroring catalog items). update_catalog_subcategory carries the gate.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { updateCatalogSubcategory } from "@/app/catalog/actions";
import { CATALOG_SUBCATEGORY_LABEL } from "@/lib/i18n/labels";

export type Subcategory = {
  id: string;
  category: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function EditSubcategory({ subcategory }: { subcategory: Subcategory }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(subcategory.name);
  const [sortOrder, setSortOrder] = useState(String(subcategory.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function close() {
    setName(subcategory.name);
    setSortOrder(String(subcategory.sortOrder));
    setError(null);
    setOpen(false);
  }

  const canSubmit = name.trim() !== "" && !submitting;

  function run(isActive: boolean) {
    setError(null);
    startSubmit(async () => {
      const result = await updateCatalogSubcategory({
        id: subcategory.id,
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

      <BottomSheet open={open} title={`แก้ไข${CATALOG_SUBCATEGORY_LABEL}`} onClose={close}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>รหัสหมวดย่อย</span>
            <span className="text-ink bg-sunk w-fit rounded px-2 py-1 font-mono text-sm">
              {subcategory.code}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sce-name" className={LABEL}>
              ชื่อ{CATALOG_SUBCATEGORY_LABEL}
            </label>
            <input
              id="sce-name"
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sce-order" className={LABEL}>
              ลำดับ
            </label>
            <input
              id="sce-order"
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
