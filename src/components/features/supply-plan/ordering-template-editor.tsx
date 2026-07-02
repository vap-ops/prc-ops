"use client";

// Spec 245 U4 — the stripped-down ordering-template editor: item + qty + note
// rows only, reusing the shared SupplyPlanDraftRow (no wpSlot — a template has
// no project or WPs, D5) and the U3 category grouping for the saved list. NO
// lifecycle (D2): a template is always editable — no submit/approve/reject/
// convert-to-PR surface exists here. Saves via bulkAddTemplateLines (the atomic
// BULK RPC underneath — never the singular add RPC, the U1 reviewer trap);
// removes via removeTemplateLine. 'use client': the draft rows + transitions.

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import {
  SupplyPlanDraftRow,
  blankRow,
  type DraftRow,
} from "@/components/features/supply-plan/draft-row";
import { groupLinesByCategory } from "@/lib/supply-plan/group-lines";
import {
  bulkAddTemplateLines,
  removeTemplateLine,
} from "@/app/settings/ordering-templates/actions";

// A saved template line (qty-only — templates are price-free like any plan).
export type TemplateEditorLine = {
  id: string;
  categoryId: string | null;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
};

export function OrderingTemplateEditor({
  templateId,
  lines,
  catalogItems,
  categories,
}: {
  templateId: string;
  lines: TemplateEditorLine[];
  catalogItems: PurchaseRequestCatalogItem[];
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();

  // Saved lines, grouped by managed category (the same review order the plan
  // grid uses — the operator fills the template category by category).
  const lineGroups = useMemo(() => groupLinesByCategory(lines, categories), [lines, categories]);

  const [rows, setRows] = useState<DraftRow[]>([blankRow()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Same forgiving rule as the plan grid: a row counts once it has an item +
  // a positive qty; blank/partial rows are ignored on save.
  const validRows = rows.filter(
    (r) => r.catalogItemId !== "" && Number.isFinite(Number(r.qty)) && Number(r.qty) > 0,
  );
  const canSave = !saving && validRows.length > 0;

  function patchRow(key: number, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setError(null);
  }
  function addRow() {
    setRows((rs) => [...rs, blankRow()]);
  }
  function dropRow(key: number) {
    setRows((rs) =>
      rs.length > 1
        ? rs.filter((r) => r.key !== key)
        : rs.map((r) => (r.key === key ? blankRow() : r)),
    );
  }

  function handleSave() {
    if (!canSave) return;
    setError(null);
    startSave(async () => {
      const result = await bulkAddTemplateLines({
        templateId,
        lines: validRows.map((r) => ({
          catalogItemId: r.catalogItemId,
          qty: Number(r.qty),
          note: r.note,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows([blankRow()]);
      router.refresh();
    });
  }

  function handleRemove(lineId: string) {
    setRemoveError(null);
    startRemove(async () => {
      const result = await removeTemplateLine({ templateId, lineId });
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {removeError ? (
        <div role="alert" className={INLINE_ERROR}>
          {removeError}
        </div>
      ) : null}

      {/* Saved template lines, grouped by category. */}
      {lines.length === 0 ? (
        <p className="text-ink-secondary text-body">
          ยังไม่มีรายการในเทมเพลต — เพิ่มรายการวัสดุด้านล่าง
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {lineGroups.map((group) => (
            <div key={group.categoryId ?? "__uncategorized__"} className="flex flex-col gap-2">
              <h3 className="text-ink-secondary text-meta font-semibold">{group.categoryName}</h3>
              <ul className="flex flex-col gap-2">
                {group.lines.map((l) => (
                  <li
                    key={l.id}
                    className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-ink text-body block font-semibold">{l.baseItem}</span>
                      {l.specAttrs ? (
                        <span className="text-ink-secondary text-meta block">{l.specAttrs}</span>
                      ) : null}
                    </span>
                    <span className="text-ink text-body shrink-0 font-semibold">
                      {l.qty} {l.unit}
                    </span>
                    <button
                      type="button"
                      aria-label="ลบ"
                      disabled={removing}
                      onClick={() => handleRemove(l.id)}
                      className="text-ink-muted hover:text-ink focus-visible:ring-action shrink-0 rounded-md p-1 focus:outline-none focus-visible:ring-2"
                    >
                      <Trash2 aria-hidden className="size-5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* The inline grid — the same multi-row entry as a plan, minus the WP column. */}
      <div className="border-edge bg-page rounded-control flex flex-col gap-3 border p-3">
        <p className="text-ink text-sm font-semibold">เพิ่มรายการวัสดุ (กรอกได้หลายแถว)</p>
        {rows.map((r) => (
          <SupplyPlanDraftRow
            key={r.key}
            row={r}
            catalogItems={catalogItems}
            categories={categories}
            disabled={saving}
            onPatch={(patch) => patchRow(r.key, patch)}
            onDrop={() => dropRow(r.key)}
          />
        ))}

        {error ? (
          <div role="alert" className={INLINE_ERROR}>
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={addRow}
            disabled={saving}
            className={`${BUTTON_SECONDARY} inline-flex items-center gap-1`}
          >
            <Plus aria-hidden className="size-4" /> เพิ่มแถว
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave} className={BUTTON_PRIMARY}>
            {saving
              ? "กำลังบันทึก…"
              : `บันทึก${validRows.length > 0 ? ` ${validRows.length} รายการ` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
