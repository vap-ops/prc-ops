"use client";

// Spec 175 U2 — "add item" to the catalog. Thin wrapper: owns the sheet open
// state; the fields + submit live in the shared CatalogItemForm (U3). The
// createCatalogItem action + the SECURITY DEFINER RPC carry the role gate +
// identity uniqueness. BottomSheet unmounts the form on close, so it reopens blank.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY } from "@/lib/ui/classes";
import { createCatalogItem } from "@/app/catalog/actions";
import {
  CatalogItemForm,
  EMPTY_CATALOG_VALUES,
  type CatalogSubcategoryOption,
} from "./catalog-item-form";

export function AddCatalogItem({
  subcategories = [],
}: {
  subcategories?: CatalogSubcategoryOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        เพิ่มวัสดุ
      </button>

      <BottomSheet open={open} title="เพิ่มรายการวัสดุ" onClose={() => setOpen(false)}>
        <CatalogItemForm
          initial={EMPTY_CATALOG_VALUES}
          subcategories={subcategories}
          submitLabel="เพิ่มรายการ"
          submittingLabel="กำลังเพิ่ม…"
          onSubmit={(values) => createCatalogItem(values)}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      </BottomSheet>
    </>
  );
}
