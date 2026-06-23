"use client";

// Spec 178 U5 — per-item SELL rate setter (super_admin only). The store sells
// stock to a WP at this transfer price; the rate is margin-sensitive money (zero
// authenticated grant), so it is read by the page via the admin client and only
// for super_admin, and written through setItemSellRate (→ set_item_sell_rate
// definer, super gate). Setting a rate affects FUTURE issues only (the snapshot
// at issue is immutable). Mirrors the EditCatalogItem per-row control.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Tag } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { FIELD_INPUT, BUTTON_PRIMARY_COMPACT, INLINE_ERROR } from "@/lib/ui/classes";
import { setItemSellRate } from "@/app/catalog/actions";
import { ITEM_SELL_RATE_LABEL, SET_ITEM_SELL_RATE_LABEL } from "@/lib/i18n/labels";

export function SetSellRate({
  itemId,
  currentRate,
}: {
  itemId: string;
  currentRate: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentRate === null ? "" : String(currentRate));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function close() {
    setError(null);
    setValue(currentRate === null ? "" : String(currentRate));
    setOpen(false);
  }

  function handleSave() {
    const rate = Number(value);
    if (value.trim() === "" || !Number.isFinite(rate) || rate < 0) {
      setError("กรอกราคาขายเป็นตัวเลข (ไม่ติดลบ)");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await setItemSellRate({ id: itemId, rate });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-action focus-visible:ring-action inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2"
      >
        <Tag aria-hidden className="size-4" />
        {currentRate === null ? SET_ITEM_SELL_RATE_LABEL : `฿${currentRate.toLocaleString()}`}
      </button>

      <BottomSheet open={open} title={SET_ITEM_SELL_RATE_LABEL} onClose={close}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-secondary font-medium">
              {ITEM_SELL_RATE_LABEL} (บาท/หน่วย)
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={FIELD_INPUT}
            />
          </label>
          {error && (
            <span role="alert" className={INLINE_ERROR}>
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={BUTTON_PRIMARY_COMPACT}
          >
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
