"use client";

// Spec 175 U2 — "add item" to the catalog. Thin wrapper: owns the sheet open
// state; the fields + submit live in the shared CatalogItemForm. Spec 239 U2 —
// the subcategory picker is flattened away, and the form can create a category
// in-flow (onCreateCategory → createCatalogCategory). The createCatalogItem action
// + the SECURITY DEFINER RPC carry the role gate + identity uniqueness.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY } from "@/lib/ui/classes";
import { createCatalogItem, createCatalogCategory } from "@/app/catalog/actions";
import { CatalogItemForm, EMPTY_CATALOG_VALUES, type CatalogUnitOption } from "./catalog-item-form";
import type { CatalogCategoryOption } from "./catalog-list";

export function AddCatalogItem({
  categories = [],
  units = [],
}: {
  categories?: CatalogCategoryOption[];
  units?: CatalogUnitOption[];
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
          categories={categories}
          units={units}
          submitLabel="เพิ่มรายการ"
          submittingLabel="กำลังเพิ่ม…"
          onSubmit={(values) => createCatalogItem(values)}
          onCreateCategory={async ({ code, name }) => {
            const result = await createCatalogCategory({ code, name, sortOrder: 0 });
            return result.ok ? { ok: true, id: result.id } : { ok: false, error: result.error };
          }}
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
