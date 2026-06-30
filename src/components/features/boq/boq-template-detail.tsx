"use client";

// Spec 237 (ADR 0066 / S10-U2) — the BOQ template detail body. Renders the header
// rename + activate/deactivate controls, the priced line table (with the computed
// line total per row + a template grand total), and the add / edit / remove line
// affordances driven by BoqLineForm.
//
// 'use client' justification: this owns the rename sheet open state, the add-line
// + per-line edit sheet open state, the remove confirm-dialog state, a
// useTransition pending state, and inline errors — all transient client-only state
// a Server Component cannot hold.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INLINE_ERROR } from "@/lib/ui/classes";
import { baht } from "@/lib/format";
import { lineTotal, templateTotal } from "@/lib/boq/totals";
import {
  BOQ_FREE_TEXT_ITEM_LABEL,
  BOQ_TEMPLATE_TOTAL_LABEL,
  BOQ_VARIATION_TYPE_OPTION_LABEL,
} from "@/lib/i18n/labels";
import {
  BoqLineForm,
  type BoqLineFormValues,
  type BoqLineSubmitValues,
  type BoqWorkCategoryOption,
} from "@/components/features/boq/boq-line-form";
import type { CatalogUnitOption } from "@/components/features/catalog/catalog-item-form";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import type { BoqLineDetail, BoqTemplateHeader } from "@/lib/boq/load";
import {
  addBoqLine,
  removeBoqLine,
  setBoqTemplateActive,
  updateBoqLine,
  updateBoqTemplate,
} from "@/app/catalog/boq-templates/actions";

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

function lineToFormValues(line: BoqLineDetail): BoqLineFormValues {
  return {
    description: line.description,
    qty: line.qty,
    unit: line.unit,
    catalogItemId: line.catalogItemId ?? "",
    workCategoryId: line.workCategoryId ?? "",
    materialRate: line.materialRate,
    laborRate: line.laborRate,
    isStandard: line.isStandard,
    variationType: line.variationType,
    exclusivityGroup: line.exclusivityGroup ?? "",
  };
}

export function BoqTemplateDetail({
  template,
  lines,
  items,
  categories,
  units,
  workCategories,
}: {
  template: BoqTemplateHeader;
  lines: BoqLineDetail[];
  items: PurchaseRequestCatalogItem[];
  categories: { id: string; name: string }[];
  units: CatalogUnitOption[];
  workCategories: BoqWorkCategoryOption[];
}) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerBusy, startHeader] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [editLine, setEditLine] = useState<BoqLineDetail | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BoqLineDetail | null>(null);
  const [removeBusy, startRemove] = useTransition();

  const grandTotal = templateTotal(
    lines.map((l) => ({ qty: l.qty, materialRate: l.materialRate, laborRate: l.laborRate })),
  );

  function saveName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (name.trim() === "" || headerBusy) return;
    setHeaderError(null);
    startHeader(async () => {
      const result = await updateBoqTemplate({
        id: template.id,
        name: name.trim(),
        description: description.trim(),
      });
      if (!result.ok) {
        setHeaderError(result.error);
        return;
      }
      setRenameOpen(false);
      router.refresh();
    });
  }

  function toggleActive() {
    setHeaderError(null);
    startHeader(async () => {
      const result = await setBoqTemplateActive({ id: template.id, isActive: !template.isActive });
      if (!result.ok) {
        setHeaderError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function confirmRemove() {
    if (!removeTarget) return;
    startRemove(async () => {
      const result = await removeBoqLine({ id: removeTarget.id, boqTemplateId: template.id });
      setRemoveTarget(null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header card — code · name · active state + controls. */}
      <section className={`${CARD} flex flex-col gap-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-ink bg-sunk text-meta inline-block rounded px-1.5 py-0.5 font-mono">
              {template.code}
            </span>
            <h2 className="text-ink text-section mt-1 font-bold break-words">{template.name}</h2>
            {template.description ? (
              <p className="text-ink-secondary text-meta mt-1">{template.description}</p>
            ) : null}
            <p className="text-meta mt-1">
              {template.isActive ? (
                <span className="text-done-strong font-medium">ใช้งานอยู่</span>
              ) : (
                <span className="text-ink-muted font-medium">ปิดใช้งาน</span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => {
                setName(template.name);
                setDescription(template.description ?? "");
                setHeaderError(null);
                setRenameOpen(true);
              }}
              className="text-action focus-visible:ring-action inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2"
            >
              <Pencil aria-hidden className="size-4" />
              แก้ไข
            </button>
            <button
              type="button"
              onClick={toggleActive}
              disabled={headerBusy}
              className="text-ink-secondary focus-visible:ring-action rounded-md px-2 py-1 text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 disabled:opacity-60"
            >
              {template.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
            </button>
          </div>
        </div>
        {headerError && (
          <div role="alert" className={INLINE_ERROR}>
            {headerError}
          </div>
        )}
      </section>

      {/* Lines + grand total. */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">
            รายการ <span className="text-ink-muted">({lines.length})</span>
          </h2>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className={`${BUTTON_PRIMARY} gap-1`}
          >
            <Plus aria-hidden className="size-4" />
            เพิ่มรายการ
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="text-ink-secondary text-body">ยังไม่มีรายการ — เพิ่มได้จากปุ่มด้านบน</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map((l) => {
              const total = lineTotal({
                qty: l.qty,
                materialRate: l.materialRate,
                laborRate: l.laborRate,
              });
              return (
                <li key={l.id} className={`${CARD} flex flex-col gap-2`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink text-body font-medium break-words">{l.description}</p>
                      <p className="text-ink-secondary text-meta mt-0.5">
                        {l.catalogItemName ?? BOQ_FREE_TEXT_ITEM_LABEL}
                        {l.workCategoryName ? ` · ${l.workCategoryName}` : ""}
                      </p>
                      <p className="text-ink-secondary text-meta mt-0.5">
                        {l.qty} × {l.unit} · {baht(l.materialRate)} + {baht(l.laborRate)}
                      </p>
                      {(!l.isStandard || l.variationType !== "standard" || l.exclusivityGroup) && (
                        <p className="text-ink-muted text-meta mt-0.5 flex flex-wrap gap-x-2">
                          {l.variationType !== "standard" ? (
                            <span>{BOQ_VARIATION_TYPE_OPTION_LABEL[l.variationType]}</span>
                          ) : null}
                          {l.isStandard ? <span>มาตรฐาน</span> : null}
                          {l.exclusivityGroup ? <span>กลุ่ม: {l.exclusivityGroup}</span> : null}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-ink text-body font-semibold tabular-nums">
                        {baht(total)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditLine(l)}
                          aria-label="แก้ไขรายการ"
                          className="text-action focus-visible:ring-action rounded-md p-1 focus:outline-none focus-visible:ring-2"
                        >
                          <Pencil aria-hidden className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoveTarget(l)}
                          aria-label="ลบรายการ"
                          className="text-danger focus-visible:ring-action rounded-md p-1 focus:outline-none focus-visible:ring-2"
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {lines.length > 0 && (
          <div className="border-edge flex items-center justify-between border-t pt-3">
            <span className="text-ink text-body font-semibold">{BOQ_TEMPLATE_TOTAL_LABEL}</span>
            <span className="text-ink text-section font-bold tabular-nums">{baht(grandTotal)}</span>
          </div>
        )}
      </section>

      {/* Rename / edit-header sheet. */}
      <BottomSheet open={renameOpen} title="แก้ไขแม่แบบ" onClose={() => setRenameOpen(false)}>
        <form onSubmit={saveName} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bt-edit-name" className={LABEL}>
              ชื่อแม่แบบ
            </label>
            <input
              id="bt-edit-name"
              type="text"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              disabled={headerBusy}
              className={FIELD}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bt-edit-desc" className={LABEL}>
              รายละเอียด (ถ้ามี)
            </label>
            <input
              id="bt-edit-desc"
              type="text"
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
              disabled={headerBusy}
              className={FIELD}
            />
          </div>
          {headerError && (
            <div role="alert" className={INLINE_ERROR}>
              {headerError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setRenameOpen(false)} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={name.trim() === "" || headerBusy}
              className={BUTTON_PRIMARY}
            >
              {headerBusy ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* Add-line sheet. */}
      <BottomSheet open={addOpen} title="เพิ่มรายการ" onClose={() => setAddOpen(false)}>
        <BoqLineForm
          boqTemplateId={template.id}
          items={items}
          categories={categories}
          units={units}
          workCategories={workCategories}
          onSubmit={(values: BoqLineSubmitValues) =>
            addBoqLine({ ...values, boqTemplateId: template.id })
          }
          onSuccess={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        />
      </BottomSheet>

      {/* Edit-line sheet (prefilled). */}
      <BottomSheet open={editLine !== null} title="แก้ไขรายการ" onClose={() => setEditLine(null)}>
        {editLine && (
          <BoqLineForm
            boqTemplateId={template.id}
            lineId={editLine.id}
            items={items}
            categories={categories}
            units={units}
            workCategories={workCategories}
            initial={lineToFormValues(editLine)}
            onSubmit={(values: BoqLineSubmitValues) =>
              updateBoqLine({ ...values, id: editLine.id, boqTemplateId: template.id })
            }
            onSuccess={() => setEditLine(null)}
            onCancel={() => setEditLine(null)}
          />
        )}
      </BottomSheet>

      <ConfirmDialog
        open={removeTarget !== null}
        message={removeTarget ? `ลบรายการ “${removeTarget.description}” ออกจากแม่แบบ?` : ""}
        confirmLabel={removeBusy ? "กำลังลบ…" : "ลบรายการ"}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
