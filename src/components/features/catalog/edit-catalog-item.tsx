"use client";

// Spec 175 U3 — per-row edit / deactivate. Owns the sheet open state + the
// deactivate (soft-delete) action; the fields live in the shared CatalogItemForm.
// updateCatalogItem / setCatalogItemActive (SECURITY DEFINER RPCs) carry the
// back-office role gate + identity uniqueness. Deactivated items drop off the
// active /catalog list (reversible — is_active=false, not a hard delete).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { setCatalogItemActive, updateCatalogItem } from "@/app/catalog/actions";
import { CatalogItemForm } from "./catalog-item-form";
import { CatalogImageControl } from "./catalog-image-control";
import type { CatalogItem } from "./catalog-list";

export function EditCatalogItem({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deactivating, startDeactivate] = useTransition();
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  function close() {
    setDeactivateError(null);
    setOpen(false);
  }

  function handleDeactivate() {
    setDeactivateError(null);
    startDeactivate(async () => {
      const result = await setCatalogItemActive({ id: item.id, active: false });
      if (!result.ok) {
        setDeactivateError(result.error);
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
        <Pencil aria-hidden className="size-4" />
        แก้ไข
      </button>

      <BottomSheet open={open} title="แก้ไขรายการวัสดุ" onClose={close}>
        <div className="mb-4">
          <CatalogImageControl itemId={item.id} thumbnailUrl={item.thumbnailUrl ?? null} />
        </div>
        <CatalogItemForm
          initial={{
            category: item.category,
            baseItem: item.baseItem,
            specAttrs: item.specAttrs ?? "",
            unit: item.unit,
            note: item.note ?? "",
          }}
          submitLabel="บันทึก"
          submittingLabel="กำลังบันทึก…"
          onSubmit={(values) => updateCatalogItem({ id: item.id, ...values })}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancel={close}
          extra={
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={deactivating}
                className={BUTTON_SECONDARY}
              >
                {deactivating ? "กำลังเอาออก…" : "เอาออก"}
              </button>
              {deactivateError && (
                <span role="alert" className={INLINE_ERROR}>
                  {deactivateError}
                </span>
              )}
            </div>
          }
        />
      </BottomSheet>
    </>
  );
}
