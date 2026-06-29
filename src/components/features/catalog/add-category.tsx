"use client";

// Spec 221 U3 — "add main category" on the /catalog taxonomy manage screen.
// Thin sheet: back-office sets a 2-digit code + name. The create_catalog_category
// SECURITY DEFINER RPC (spec 221 U1) carries the role gate + code uniqueness;
// catalog_categories has no INSERT grant.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { createCatalogCategory } from "@/app/catalog/actions";
import { CATALOG_CATEGORY_LABEL } from "@/lib/i18n/labels";

const CODE_RE = /^[0-9]{2}$/;
const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function AddCategory() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function close() {
    setCode("");
    setName("");
    setSortOrder("");
    setError(null);
    setOpen(false);
  }

  const canSubmit = CODE_RE.test(code) && name.trim() !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createCatalogCategory({
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
        เพิ่ม{CATALOG_CATEGORY_LABEL}
      </button>

      <BottomSheet open={open} title={`เพิ่ม${CATALOG_CATEGORY_LABEL}`} onClose={close}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cc-code" className={LABEL}>
              รหัส{CATALOG_CATEGORY_LABEL} (2 หลัก)
            </label>
            <input
              id="cc-code"
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
            <label htmlFor="cc-name" className={LABEL}>
              ชื่อ{CATALOG_CATEGORY_LABEL}
            </label>
            <input
              id="cc-name"
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น เหล็ก / อุปกรณ์ยึด"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cc-order" className={LABEL}>
              ลำดับ (ถ้ามี)
            </label>
            <input
              id="cc-order"
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
