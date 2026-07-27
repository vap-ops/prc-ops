"use client";

// Spec 177 U5 + spec 208 U3 — เบิก at the WP detail. A site staffer (site_admin
// draws at the WP, plus the PM tier) pulls stock from the project store TO this
// work package, at moving-average cost (the issue_stock_bulk RPC handles costing +
// decrement). Spec 208 U3: the เบิก sheet is a MULTI-LINE grid — withdraw several
// items to this WP in one atomic call. 'use client': the grid state, the submit
// transition, the refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { ReturnToStoreControl } from "@/components/features/store/return-to-store-control";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { STORE_ISSUE_LABEL, STORE_FIX_WRONG_ENTRY_LABEL } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { scopeStockRows } from "@/lib/catalog/scoped-picker";
import { ScopedCatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import { PersonPicker } from "@/components/features/common/person-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import type { CatalogItemKind, ScopedMaterialCategory } from "@/lib/catalog/scoped-categories";
import { confirmStockIssueOnBehalf, issueStockBulk, reverseStockIssue } from "@/app/store/actions";

// On-hand for the picker — only what the WP เบิก needs (the value/avg-cost columns
// the /store console shows are not relevant when drawing to a WP).
export type WpStockRow = {
  catalogItemId: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qtyOnHand: number;
  // Spec 229 (ADR 0066 / S8): the item's canonical category + kind, so the เบิก
  // <select> can scope the on-hand list to the WP's work-category (Relation R),
  // separating tools from materials. Nullable — an item may be uncategorised.
  categoryId: string | null;
  kind: CatalogItemKind | null;
};

export type WpIssueRow = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  unitCost: number;
  // Custody (spec 177 U6/U7): the named receiver + whether they've confirmed.
  receiverName: string | null;
  receivedAt: string | null;
  // Spec 209 U2: qty already returned to the store from this issue (≤ qty).
  returnedQty: number;
};

// Spec 208 U3 — one draft row of the multi-line เบิก grid.
type DraftIssueRow = { item: string; qty: string; receiver: string; note: string };
const emptyIssueRow = (): DraftIssueRow => ({ item: "", qty: "", receiver: "", note: "" });

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

// Spec 229: a stable empty membership map for the unscoped show-all fallback.
const EMPTY_MEMBERSHIPS: ReadonlyMap<string, Set<string>> = new Map();

export function WpIssueStock({
  initialCatalogItemId,
  embedded = false,
  projectId,
  workPackageId,
  onHand,
  workers,
  issues,
  scopedRelation,
  membershipsByItem,
  categories,
}: {
  projectId: string;
  workPackageId: string;
  onHand: WpStockRow[];
  workers: { id: string; name: string }[];
  issues: WpIssueRow[];
  // Spec 229 (ADR 0066 D5/D8): the WP work-category's Relation R (category +
  // optional kind narrowing). Non-empty → surface the matching on-hand stock
  // first under a ตรงกับงาน optgroup; empty/absent → a flat list (show-all
  // fallback). NEVER hides — every on-hand item stays selectable.
  scopedRelation?: ScopedMaterialCategory[] | undefined;
  // Spec 229: catalogItemId → its secondary category ids (the S4 union source).
  membershipsByItem?: ReadonlyMap<string, Set<string>> | undefined;
  // Spec 363 U4: the managed catalog categories, for the picker's filter chips.
  categories: { id: string; name: string }[];
  /** Spec 363 U4 — the ต้องการของ sheet picks the item once and hands it down. */
  initialCatalogItemId?: string | undefined;
  /** Spec 363 U4 — rendered INSIDE the ต้องการของ sheet: the form alone, with no
   *  trigger of its own (the SA already pressed one), no BottomSheet (the parent
   *  IS one — nesting would stack a third), and no recent-เบิก list (the ของ tab
   *  already lists them). */
  embedded?: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  // Spec 363 U4 — the ต้องการของ sheet chooses the item ONCE and hands it down,
  // so each path opens with the item already selected rather than asking again.
  const [rows, setRows] = useState<DraftIssueRow[]>([
    { ...emptyIssueRow(), item: initialCatalogItemId ?? "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [issuing, startIssue] = useTransition();

  function updateRow(i: number, patch: Partial<DraftIssueRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyIssueRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
  }

  const onHandOf = (id: string) => onHand.find((o) => o.catalogItemId === id) ?? null;
  // Spec 208 U2/U3 — per-row qty ceiling: you cannot เบิก more than is on hand
  // (the issue_stock_bulk RPC also 22023s; this blocks it before the round-trip).
  const rowOverStock = (r: DraftIssueRow) => {
    const oh = onHandOf(r.item);
    const q = Number(r.qty);
    return oh !== null && Number.isFinite(q) && q > oh.qtyOnHand;
  };
  const rowComplete = (r: DraftIssueRow) => {
    const q = Number(r.qty);
    return r.item !== "" && r.qty !== "" && Number.isFinite(q) && q > 0 && !rowOverStock(r);
  };
  const completeRows = rows.filter(rowComplete);
  const anyOverStock = rows.some(rowOverStock);
  const canSubmit = completeRows.length > 0 && !anyOverStock && !issuing;

  function reset() {
    setRows([emptyIssueRow()]);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startIssue(async () => {
      const result = await issueStockBulk({
        projectId,
        workPackageId,
        lines: completeRows.map((r) => ({
          catalogItemId: r.item,
          qty: Number(r.qty),
          note: r.note,
          ...(r.receiver !== "" ? { receiverWorkerId: r.receiver } : {}),
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  // Spec 229: order + flag the on-hand list against the WP work-category's
  // Relation R (kind-aware). scopeActive only when the scope has real matches —
  // otherwise the flat list shows (never an empty / over-grouped select).
  const scopedOnHand = scopeStockRows(
    onHand,
    membershipsByItem ?? EMPTY_MEMBERSHIPS,
    scopedRelation,
  );
  const scopeActive = scopedOnHand.scoped && scopedOnHand.inScopeCount > 0;
  const inScopeRows = scopedOnHand.entries.filter((e) => e.inScope).map((e) => e.row);
  // Spec 363 U4 slice 1 — the native <select> is replaced by the searchable
  // picker ขอซื้อ and ซื้อเอง already use. Field report 2026-07-27: 369 on-hand
  // options, labels to 118 chars, no search, and the OS owns the sheet.
  //
  // The on-hand row is mapped into the picker's item shape. categoryName comes
  // from the managed list; thumbnailUrl is null because on-hand rows carry no
  // signed image URL (the /catalog picker mints those page-side) — the picker
  // falls back to its placeholder icon.
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const pickerItems: PurchaseRequestCatalogItem[] = onHand.map((o) => ({
    id: o.catalogItemId,
    categoryId: o.categoryId,
    categoryName: o.categoryId ? (categoryNameById.get(o.categoryId) ?? "") : "",
    baseItem: o.baseItem,
    specAttrs: o.specAttrs,
    unit: o.unit,
    thumbnailUrl: null,
  }));
  // The quantity becomes a trailing BADGE instead of the tail of a sentence.
  const badgeByItem = new Map(onHand.map((o) => [o.catalogItemId, `${o.qtyOnHand} ${o.unit}`]));
  // scopeStockRows is kind-aware (spec 229); the picker's own matcher is
  // category-only, so hand it the decision rather than let it re-derive one.
  const inScopeIds = inScopeRows.map((r) => r.catalogItemId);
  const scopedCategoryIds = (scopedRelation ?? []).map((r) => r.categoryId);

  // Spec 363 U4 — the form is hoisted so it can render EITHER wrapped in this
  // component's own BottomSheet (the เบิกของ tab) or bare inside the ต้องการของ
  // sheet, which is already a BottomSheet. Nesting them would stack a third
  // sheet behind a second trigger the SA has no reason to press.
  const issueForm = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Spec 208 U3: a multi-row grid — เบิก a whole list to this WP at once. */}
      <ul className="flex flex-col gap-4">
        {rows.map((r, i) => {
          const selected = onHandOf(r.item);
          const over = rowOverStock(r);
          return (
            <li key={i} className="border-edge rounded-control flex flex-col gap-3 border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-meta text-ink-secondary font-semibold">รายการ {i + 1}</span>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={issuing}
                    className="text-danger text-meta font-medium"
                  >
                    ลบ
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <ScopedCatalogItemPicker
                  items={pickerItems}
                  categories={categories}
                  selectedId={r.item}
                  onSelect={(id) => updateRow(i, { item: id })}
                  onClear={() => updateRow(i, { item: "" })}
                  disabled={issuing}
                  label="วัสดุในคลัง"
                  badgeByItem={badgeByItem}
                  triggerLabel="เลือกวัสดุจากคลัง"
                  emptyState={
                    // The catalog default ("register it in ตั้งค่า → แคตตาล็อก")
                    // is wrong guidance here: on เบิก the item is usually IN the
                    // catalog and simply out of stock, and a site admin cannot add
                    // catalog entries. The real next action is a purchase request.
                    <div className="border-edge-strong rounded-control border border-dashed px-3 py-4">
                      <p className="text-ink-secondary text-sm">
                        ไม่มีวัสดุนี้ในคลัง — ถ้าต้องใช้ ให้สร้างคำขอซื้อ
                      </p>
                    </div>
                  }
                  {...(scopeActive ? { scopedCategoryIds, inScopeIds, membershipsByItem } : {})}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={`wp-issue-qty-${i}`} className={LABEL}>
                  จำนวน
                </label>
                <input
                  id={`wp-issue-qty-${i}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={r.qty}
                  onChange={(e) => updateRow(i, { qty: e.target.value })}
                  disabled={issuing}
                  className={FIELD}
                />
                {selected ? (
                  <p className={`text-meta ${over ? "text-danger" : "text-ink-secondary"}`}>
                    {over
                      ? `เกินจำนวนในคลัง (มี ${selected.qtyOnHand} ${selected.unit})`
                      : `มีในมือ ${selected.qtyOnHand} ${selected.unit}`}
                  </p>
                ) : null}
              </div>

              {/* Custody (spec 177 U7): name the receiver who takes the material;
                      they confirm receipt later from the worker portal. Optional.

                      Spec 363 U4 slice 1b — off the native <select> and onto the
                      same searchable-sheet idiom as the วัสดุ field above it.
                      Slice 1 swapped only the material field, which left two
                      adjacent controls asking the same kind of question in two
                      different idioms (operator 2026-07-27). The roster is 30
                      names on the pilot project — long enough that scrolling an
                      OS wheel to find one man is the same hunt the material
                      field just stopped being. */}
              <PersonPicker
                label="ผู้รับ (ถ้ามี)"
                people={workers}
                selectedId={r.receiver}
                onChange={(id) => updateRow(i, { receiver: id })}
                disabled={issuing}
                restingLabel="ไม่ระบุ"
                clearLabel="ไม่ระบุ"
                searchPlaceholder="ค้นหาชื่อ"
                sheetTitle="เลือกผู้รับ"
                emptyRosterLabel="ยังไม่มีช่างในโครงการนี้"
              />

              <div className="flex flex-col gap-1.5">
                <label htmlFor={`wp-issue-note-${i}`} className={LABEL}>
                  หมายเหตุ (ถ้ามี)
                </label>
                <input
                  id={`wp-issue-note-${i}`}
                  type="text"
                  value={r.note}
                  maxLength={1000}
                  onChange={(e) => updateRow(i, { note: e.target.value })}
                  disabled={issuing}
                  className={FIELD}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" onClick={addRow} disabled={issuing} className={BUTTON_SECONDARY}>
        + เพิ่มรายการ
      </button>

      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
          ยกเลิก
        </button>
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {issuing ? "กำลังเบิก…" : "ยืนยันการเบิก"}
        </button>
      </div>
    </form>
  );

  if (embedded) return issueForm;

  return (
    <div className="flex flex-col gap-3">
      {onHand.length === 0 ? (
        <p className="text-ink-secondary text-body">ยังไม่มีสต๊อกในคลัง</p>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
            เบิกวัสดุจากคลัง
          </button>
        </div>
      )}

      {issues.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {issues.map((i) => (
            <li
              key={i.id}
              className="border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="text-ink text-body block font-semibold">{i.baseItem}</span>
                <span className="text-ink-secondary text-meta block">
                  {i.specAttrs ? `${i.specAttrs} · ` : ""}
                  ต้นทุน {baht(i.unitCost)} ฿/{i.unit}
                </span>
                {i.receiverName ? (
                  <span className="text-meta mt-0.5 block">
                    <span className={i.receivedAt ? "text-action" : "text-ink-muted"}>
                      {i.receivedAt ? "รับแล้ว" : "รอรับ"}
                    </span>
                    <span className="text-ink-secondary"> · {i.receiverName}</span>
                  </span>
                ) : null}
              </span>
              <span className="text-ink text-body shrink-0 font-semibold">
                {i.qty} {i.unit}
              </span>
              {/* Spec 209 U2 — the REAL return: send a partial qty of issued
                  material back to the store (offcuts/leftovers), at the issue cost. */}
              <ReturnToStoreControl
                issueId={i.id}
                baseItem={i.baseItem}
                unit={i.unit}
                remaining={i.qty - i.returnedQty}
              />
              {/* Spec 210 — confirm-on-behalf moved here from the store console: a
                  site staffer attests receipt for a named receiver who is still
                  รอรับ, right where the เบิก was made. The RPC blocks the issuer
                  (separation of duties) and the error maps cleanly. */}
              {i.receiverName && !i.receivedAt ? (
                <ConfirmActionButton
                  idleLabel="ยืนยันรับแทน"
                  pendingLabel="กำลังยืนยัน…"
                  confirmMessage={`ยืนยันว่าผู้รับได้รับ ${i.baseItem} ${i.qty} ${i.unit} แล้ว (ยืนยันแทนผู้รับ)?`}
                  confirmLabel="ยืนยัน"
                  buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
                  action={() => confirmStockIssueOnBehalf({ issueId: i.id })}
                />
              ) : null}
              {/* Spec 178 Stream B — undo a wrong เบิก here too (mirrors /store U12).
                  This block only renders for SITE_STAFF (the WP-detail !readOnly
                  gate), which is the reverse_stock_issue gate. */}
              <ConfirmActionButton
                idleLabel={STORE_FIX_WRONG_ENTRY_LABEL}
                pendingLabel="กำลังแก้ไข…"
                confirmMessage={`ลบรายการเบิกที่บันทึกผิด — ${i.baseItem} ${i.qty} ${i.unit}? ใช้เมื่อบันทึกผิด ไม่ใช่การคืนของจริง (ของจะถูกคืนเข้าคลัง)`}
                confirmLabel="ยืนยัน"
                buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
                action={() => reverseStockIssue({ issueId: i.id })}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <BottomSheet open={open} title={STORE_ISSUE_LABEL} onClose={() => setOpen(false)}>
        {issueForm}
      </BottomSheet>
    </div>
  );
}
