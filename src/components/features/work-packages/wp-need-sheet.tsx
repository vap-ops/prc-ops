"use client";

// Spec 363 U4 (D5) — `ต้องการของ`: ONE entry point for "I need something here".
//
// 'use client' justification: the sheet owns the item + path selection state.
//
// The three write paths are NOT rewritten — they are re-composed. This asks for
// the ITEM first, lets the shelf decide which action leads (see
// `@/lib/work-packages/need-path`), and then renders the EXISTING form for the
// chosen path with the item already selected. Withdraw-vs-request-vs-self-buy is
// the firm's ledger taxonomy; the SA's state is "I need ปูน".
//
// ⚠️ ONE PICKER, ONE SCOPE — a deliberate change, flagged by spec §5. The three
// forms' prop sets differ: PurchaseRequestForm took `scopedCategoryIds` +
// `membershipsByItem`, WpIssueStock took `scopedRelation` + `membershipsByItem`,
// and SelfPurchaseSection took NEITHER. Choosing the item once means the picker
// gets the SUPERSET, so ซื้อมาเองแล้ว now inherits the spec 229/297 work-category
// ORDERING it never had — the WP's materials surface first.
//
// ⚠️ It does NOT inherit the persistent off-category WARNING. That branch keys
// on the picker's own `selectedId`, and this picker runs with selectedId=""
// (the sheet owns the selection), so the warning renders nowhere on the self
// path — including for the later approver. Threading the scope into
// SelfPurchaseForm is a follow-up; the claim is corrected here rather than left
// overstating what the unit delivered.

import { useState } from "react";
import { Package } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ScopedCatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import { PurchaseRequestForm } from "@/components/features/purchasing/purchase-request-form";
import { SelfPurchaseForm } from "@/components/features/purchasing/self-purchase-form";
import { WpIssueStock } from "@/components/features/store/wp-issue-stock";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD } from "@/lib/ui/classes";
import { decideNeedPath, NEED_PATHS, type NeedPath } from "@/lib/work-packages/need-path";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import type { WpIssueRow, WpStockRow } from "@/components/features/store/wp-issue-stock";
import type { ScopedMaterialCategory } from "@/lib/catalog/scoped-categories";

const PATH_LABEL: Record<NeedPath, string> = {
  issue: "เบิกจากคลัง",
  request: "ขอซื้อ",
  self: "ซื้อมาเองแล้ว",
};

export function WpNeedSheet({
  workPackage,
  projectId,
  userId,
  catalogItems,
  categories,
  onHand,
  workers,
  issues,
  scopedCategoryIds,
  membershipsByItem,
  scopedRelation,
  canSelfApprove = false,
  allowedPaths,
}: {
  workPackage: { id: string; code: string; name: string; categoryCode: string | null };
  projectId: string;
  userId: string;
  catalogItems: PurchaseRequestCatalogItem[];
  categories: { id: string; name: string }[];
  onHand: WpStockRow[];
  workers: { id: string; name: string }[];
  issues: WpIssueRow[];
  scopedCategoryIds?: string[] | undefined;
  membershipsByItem?: ReadonlyMap<string, Set<string>> | undefined;
  scopedRelation?: ScopedMaterialCategory[] | undefined;
  canSelfApprove?: boolean;
  /**
   * Spec 363 U4 merge — the paths THIS viewer may take. Omitted = all three.
   * Deleting the คำขอซื้อ tab makes this sheet the only PR door on the page, and
   * plain `procurement` (a read-only WP viewer) may raise a purchase request and
   * nothing else. Gating the whole sheet on `!readOnly` would delete that
   * capability outright, so the page hands the role its one path instead.
   */
  allowedPaths?: readonly NeedPath[] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [path, setPath] = useState<NeedPath | null>(null);
  // Spec 363 U4 — once a path has been entered, dismissal must be deliberate.
  // SelfPurchaseForm's post-record state is the ONLY surface rendering its
  // evidence uploaders, so a stray scrim tap there records an expense and
  // leaves it permanently ยังไม่สมบูรณ์ unless the SA finds /requests/[id].
  const [entered, setEntered] = useState(false);

  const item = itemId ? (catalogItems.find((i) => i.id === itemId) ?? null) : null;
  // `null` (never stocked) is NOT the same as 0 — decideNeedPath distinguishes
  // them, and both correctly mean "nothing to withdraw".
  const stock = itemId ? (onHand.find((o) => o.catalogItemId === itemId) ?? null) : null;
  const decision = decideNeedPath(stock ? stock.qtyOnHand : null, allowedPaths ?? NEED_PATHS);

  function close() {
    setOpen(false);
    setItemId("");
    setPath(null);
    setEntered(false);
  }

  // Changing the item invalidates the path — the shelf answer differs per item,
  // so keeping a chosen path across a change could land the SA on เบิก for
  // something the store does not hold.
  function chooseItem(id: string) {
    setItemId(id);
    setPath(null);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        ต้องการของ
      </button>

      <BottomSheet open={open} title="ต้องการของ" onClose={entered ? () => undefined : close}>
        <div className="flex flex-col gap-4">
          {item === null ? (
            <ScopedCatalogItemPicker
              label="ต้องการอะไร"
              items={catalogItems}
              categories={categories}
              selectedId=""
              onSelect={chooseItem}
              onClear={() => chooseItem("")}
              triggerLabel="เลือกวัสดุ"
              {...(scopedCategoryIds ? { scopedCategoryIds } : {})}
              {...(membershipsByItem ? { membershipsByItem } : {})}
            />
          ) : (
            <>
              <div className={CARD}>
                <div className="flex items-center gap-3">
                  <Package aria-hidden className="text-ink-muted size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="text-ink text-body block font-semibold">
                      {/* specAttrs is the difference between เหล็กเส้น 6mm and 9mm —
                          dropping it makes this card unable to do its one job. */}
                      {item.baseItem}
                      {item.specAttrs ? ` ${item.specAttrs}` : ""}
                    </span>
                    {/* The shelf figure IS the reason the actions are ordered the
                        way they are, so it is stated rather than left implicit. */}
                    <span className="text-ink-secondary text-meta block">
                      {stock ? `ในคลังมี ${stock.qtyOnHand} ${stock.unit}` : "ไม่มีในคลัง"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      chooseItem("");
                      setEntered(false);
                    }}
                    className="text-action shrink-0 rounded text-sm font-medium underline-offset-2 hover:underline"
                  >
                    เปลี่ยนวัสดุ
                  </button>
                </div>
              </div>

              {path === null ? (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPath(decision.primary);
                      setEntered(true);
                    }}
                    className={BUTTON_PRIMARY}
                  >
                    {PATH_LABEL[decision.primary]}
                  </button>
                  {decision.secondary.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setPath(p);
                        setEntered(true);
                      }}
                      className={BUTTON_SECONDARY}
                    >
                      {PATH_LABEL[p]}
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  {path === "issue" ? (
                    <WpIssueStock
                      projectId={projectId}
                      workPackageId={workPackage.id}
                      onHand={onHand}
                      workers={workers}
                      issues={issues}
                      categories={categories}
                      initialCatalogItemId={itemId}
                      embedded
                      onDone={close}
                      onCancel={() => setPath(null)}
                      {...(scopedRelation ? { scopedRelation } : {})}
                      {...(membershipsByItem ? { membershipsByItem } : {})}
                    />
                  ) : path === "request" ? (
                    <PurchaseRequestForm
                      workPackage={workPackage}
                      projectId={projectId}
                      userId={userId}
                      canSelfApprove={canSelfApprove}
                      catalogItems={catalogItems}
                      categories={categories}
                      initialCatalogItemId={itemId}
                      {...(scopedCategoryIds ? { scopedCategoryIds } : {})}
                      {...(membershipsByItem ? { membershipsByItem } : {})}
                    />
                  ) : (
                    <SelfPurchaseForm
                      projectId={projectId}
                      workPackageId={workPackage.id}
                      catalogItems={catalogItems}
                      categories={categories}
                      initialCatalogItemId={itemId}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
