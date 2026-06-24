"use client";

import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";

// 'use client' justification (feature spec 09, ADR 0022; reshaped by spec 10):
//
// This form owns input state, inline validation, a useTransition pending
// state, and a "Saved" confirmation that must appear only AFTER an actual
// successful round-trip in this session. A Server Component cannot hold
// those — the post-save signal is a transient client-only flag, not
// derived from server-rendered props. Mirrors DisplayNameForm.
//
// Spec 10: the form is pinned to ONE work package, resolved by the parent
// Server Component from the ?wp= searchParam (requests are raised FROM a
// WP screen, never via a picker). The pure validator from
// src/lib/purchasing/validate-purchase-request.ts is the single source of
// truth for shape — the action layer runs the same one.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseRequest, decidePurchaseRequest } from "@/app/requests/actions";
import {
  PurchaseRequestAttachmentStager,
  type AttachmentStagerHandle,
} from "@/components/features/purchasing/purchase-request-attachment-stager";
import { CatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import {
  PURCHASE_PRIORITIES,
  validateCreatePurchaseRequest,
  type PurchasePriority,
} from "@/lib/purchasing/validate-purchase-request";
import { PURCHASE_REASON_CODES } from "@/lib/purchasing/reason-code";
import {
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_REASON_CODE_LABEL,
} from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";
import { bangkokTodayIso } from "@/lib/dates";

type ItemCategory = Database["public"]["Enums"]["item_category"];

// Spec 179/180: a catalog master item the requester picks (search + thumbnail).
export interface PurchaseRequestCatalogItem {
  id: string;
  category: ItemCategory;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  // Spec 180 pro-max: a signed URL for the item's reference image (minted by the
  // page), or null when the item has no image.
  thumbnailUrl: string | null;
}

// Selected-segment colors mirror the request list's status pills (spec 21):
// color only the chosen urgency so the row doesn't read as an alert at rest.
const PRIORITY_SELECTED_CLASS: Record<PurchasePriority, string> = {
  normal: "border-fill bg-fill text-on-fill",
  urgent: "border-attn bg-attn text-on-attn",
  critical: "border-danger bg-danger text-on-fill",
};

export interface PurchaseRequestFormWorkPackage {
  id: string;
  code: string;
  name: string;
}

interface PurchaseRequestFormProps {
  workPackage: PurchaseRequestFormWorkPackage;
  // Spec 16 P2: the stager builds the canonical storage path client-side
  // for the direct-to-bucket upload; the parent Server Component already
  // knows the pinned WP's project.
  projectId: string;
  /** Session user — enables the stager's offline-queue bracket at flush
   *  time (spec 37). */
  userId: string;
  /** Spec 136: PM/super raising a request on their own WP page — the submit
   *  becomes "สร้างและอนุมัติ" and self-approves it after create. */
  canSelfApprove?: boolean;
  /** Spec 179/180: the active catalog master (spec 175). The PR item is
   *  catalog-only — the requester searches this list and picks one (linking
   *  catalog_item_id, deriving the description + unit). Required: every PR form
   *  needs the catalog. An item not in the catalog is registered first at
   *  ตั้งค่า → แคตตาล็อก (no inline add). */
  catalogItems: PurchaseRequestCatalogItem[];
}

export function PurchaseRequestForm({
  workPackage,
  projectId,
  userId,
  canSelfApprove = false,
  catalogItems,
}: PurchaseRequestFormProps) {
  const router = useRouter();
  // Spec 195 P1: the work package is now optional. "wp" binds the request to
  // this WP (the default — you're on its screen); "project" makes it a
  // project-level / store-bound request (work_package_id null, เบิกเข้างานภายหลัง).
  const [scope, setScope] = useState<"wp" | "project">("wp");
  const effectiveWorkPackageId = scope === "wp" ? workPackage.id : null;
  // Spec 180: the PR item is catalog-only — catalogItemId is the chosen item
  // ("" = none yet). The search/category/sheet state lives in CatalogItemPicker;
  // the description + unit are DERIVED here from the chosen item (no free text).
  const [catalogItemId, setCatalogItemId] = useState<string>("");
  const [quantityText, setQuantityText] = useState<string>("");
  const [neededBy, setNeededBy] = useState<string>("");
  const [priority, setPriority] = useState<PurchasePriority>("normal");
  // Spec 176 U4: required reactive-reason — no preselect (empty = unchosen).
  const [reasonCode, setReasonCode] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [approvedSaved, setApprovedSaved] = useState<boolean>(false);
  const [attachmentNote, setAttachmentNote] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const stagerRef = useRef<AttachmentStagerHandle>(null);

  // Spec 180: the chosen catalog item is the single source of the item identity.
  // item_description + unit are an immutable snapshot derived from it (the หมายเหตุ
  // note carries any brand/model refinement) — there is no free-text item input.
  const selectedItem = catalogItemId
    ? (catalogItems.find((c) => c.id === catalogItemId) ?? null)
    : null;
  const itemDescription = selectedItem
    ? selectedItem.baseItem + (selectedItem.specAttrs ? ` ${selectedItem.specAttrs}` : "")
    : "";
  const unit = selectedItem?.unit ?? "";

  // Quantity is a numeric column at the DB and the validator wants a
  // finite positive number. The input is a free-text field so users can
  // type "12.5", "0.5", etc.; parseFloat returns NaN for empties /
  // garbage, which the validator then rejects cleanly.
  const quantity = quantityText.trim().length === 0 ? Number.NaN : Number.parseFloat(quantityText);

  const localValidation = validateCreatePurchaseRequest({
    projectId,
    workPackageId: effectiveWorkPackageId,
    itemDescription,
    quantity,
    unit,
    neededBy: neededBy.length > 0 ? neededBy : null,
    priority,
    notes: notes.length > 0 ? notes : null,
    reasonCode: reasonCode.length > 0 ? reasonCode : null,
    catalogItemId,
  });
  // Catalog-only: a chosen item is required (the validator stays lenient for the
  // non-form create paths, so gate it explicitly here too).
  const canSubmit = !submitting && localValidation.ok && catalogItemId !== "";

  function runSubmit(autoApprove: boolean) {
    if (!canSubmit) return;
    setError(null);
    setSavedAt(null);
    startSubmit(async () => {
      const result = await createPurchaseRequest({
        projectId,
        workPackageId: effectiveWorkPackageId,
        itemDescription,
        quantity,
        unit,
        neededBy: neededBy.length > 0 ? neededBy : null,
        priority,
        notes: notes.length > 0 ? notes : null,
        reasonCode: reasonCode.length > 0 ? reasonCode : null,
        // Spec 180: catalog-only — a chosen item is always linked (gated above).
        catalogItemId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Staged attachments flush AFTER the request exists; failures never
      // roll back the request (spec 16 §4) — failed items stay in the
      // stager with ลองใหม่ and a note appears beside บันทึกแล้ว.
      const failedAttachments = (await stagerRef.current?.flush(result.id)) ?? 0;
      // Spec 136: a PM/super raising their own request approves it in one step
      // (they are the approver — no point leaving it pending). If the approve
      // leg fails the request still exists (pending), approvable from the list.
      let selfApproved = false;
      if (autoApprove) {
        const decision = await decidePurchaseRequest({
          id: result.id,
          decision: "approved",
          comment: null,
        });
        selfApproved = decision.ok;
        if (!decision.ok) {
          setError("สร้างคำขอแล้ว แต่อนุมัติไม่สำเร็จ — อนุมัติได้จากรายการคำขอซื้อ");
        }
      }
      setAttachmentNote(
        failedAttachments > 0 ? "บางรายการแนบไม่สำเร็จ — กดลองใหม่ในรายการด้านบน" : null,
      );
      // Pessimistic confirmation: only after the round-trip succeeded.
      // Clear the inputs so the form is ready for the next request on the
      // same WP; the router.refresh() re-runs the Server Component so the
      // list picks up the new row.
      setCatalogItemId("");
      setQuantityText("");
      setNeededBy("");
      setPriority("normal");
      setReasonCode("");
      setNotes("");
      setApprovedSaved(autoApprove && selfApproved);
      // Suppress the green confirmation when the auto-approve leg failed — the
      // inline error already says "created but not approved".
      if (!autoApprove || selfApproved) setSavedAt(Date.now());
      router.refresh();
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    runSubmit(canSelfApprove);
  }

  // Spec 180: CatalogItemPicker (search + sheet) owns the selection UI; the form
  // just records the chosen id. เปลี่ยน clears it so the picker reopens.
  function selectCatalogItem(id: string) {
    setCatalogItemId(id);
    setError(null);
    setSavedAt(null);
  }
  function clearCatalogItem() {
    setCatalogItemId("");
    setError(null);
    setSavedAt(null);
  }

  // Inline validation only after the user has touched the form. Same shape as
  // DisplayNameForm — keeps an untouched form quiet. The pinned WP id never
  // counts as "typed".
  const userTyped =
    catalogItemId.length > 0 ||
    quantityText.length > 0 ||
    neededBy.length > 0 ||
    reasonCode.length > 0 ||
    notes.length > 0;
  const inlineError = error ?? (!localValidation.ok && userTyped ? localValidation.error : null);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-control border-edge-strong bg-page shadow-card flex flex-col gap-3 border p-4"
    >
      {/* Spec 195 P1: the work package is optional. Bind the request to this WP
          (default), or raise it for the whole project (เข้าสโตร์ — material is
          received into the project store, เบิกเข้างานภายหลัง). */}
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="text-ink text-sm font-medium">ขอซื้อเข้า</legend>
        <div className="flex gap-1.5">
          {(
            [
              ["wp", "ผูกกับงานนี้"],
              ["project", "ทั้งโครงการ (เข้าสโตร์)"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`focus-within:ring-action inline-flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md border text-center text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-offset-1 ${
                scope === value
                  ? "border-fill bg-fill text-on-fill"
                  : "border-edge-strong bg-card text-ink"
              } ${submitting ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="pr-scope"
                value={value}
                checked={scope === value}
                onChange={() => {
                  setScope(value);
                  setError(null);
                  setSavedAt(null);
                }}
                disabled={submitting}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        {scope === "wp" ? (
          <p className="border-edge-strong bg-card mt-1 truncate rounded-md border px-3 py-2 text-sm">
            <span className="text-ink-secondary font-mono">{workPackage.code}</span>
            <span className="text-ink-muted mx-1">·</span>
            <span className="text-ink">{workPackage.name}</span>
          </p>
        ) : (
          <p className="text-ink-secondary mt-1 text-xs">
            วัสดุเข้าสโตร์ของโครงการ แล้วเบิกเข้างานภายหลัง
          </p>
        )}
      </fieldset>

      {/* Spec 180 (pro-max): catalog-only material picker — a search-driven
          bottom sheet (CatalogItemPicker). The chosen item drives the
          description + unit; an off-catalog item is registered at /catalog. */}
      <CatalogItemPicker
        items={catalogItems}
        selectedId={catalogItemId}
        onSelect={selectCatalogItem}
        onClear={clearCatalogItem}
        disabled={submitting}
      />

      {/* Spec 180: หน่วย is derived from the chosen catalog item (shown in the
          chip above), so the requester enters only the quantity here. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="pr-qty" className="text-ink text-sm font-medium">
          จำนวน
        </label>
        <input
          id="pr-qty"
          type="text"
          inputMode="decimal"
          value={quantityText}
          onChange={(e) => {
            setQuantityText(e.target.value);
            setError(null);
            setSavedAt(null);
          }}
          disabled={submitting}
          className={FIELD_INPUT}
          placeholder="10"
        />
      </div>

      {/* Always stacked: the form's primary home is the WP page's narrow
          right rail (spec 29), where sm: viewport variants lie about the
          available CONTAINER width — the side-by-side row cramped the
          date input and wrapped the urgency buttons (operator screenshot
          2026-06-11). */}
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="pr-needed-by" className="text-ink text-sm font-medium">
            ต้องการรับของภายใน (ไม่บังคับ)
          </label>
          <input
            id="pr-needed-by"
            type="date"
            value={neededBy}
            min={bangkokTodayIso()}
            onChange={(e) => {
              setNeededBy(e.target.value);
              setError(null);
              setSavedAt(null);
            }}
            disabled={submitting}
            className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full max-w-full min-w-0 appearance-none border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
          />
        </div>
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="text-ink text-sm font-medium">ความเร่งด่วน</legend>
          <div className="flex gap-1.5">
            {PURCHASE_PRIORITIES.map((p) => (
              <label
                key={p}
                className={`focus-within:ring-action inline-flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-offset-1 ${
                  priority === p
                    ? PRIORITY_SELECTED_CLASS[p]
                    : "border-edge-strong bg-card text-ink"
                } ${submitting ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name="pr-priority"
                  value={p}
                  checked={priority === p}
                  onChange={() => {
                    setPriority(p);
                    setError(null);
                    setSavedAt(null);
                  }}
                  disabled={submitting}
                  className="sr-only"
                />
                {PURCHASE_REQUEST_PRIORITY_LABEL[p]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pr-reason" className="text-ink text-sm font-medium">
          เหตุผลที่ต้องสั่งซื้อ
        </label>
        <select
          id="pr-reason"
          value={reasonCode}
          onChange={(e) => {
            setReasonCode(e.target.value);
            setError(null);
            setSavedAt(null);
          }}
          disabled={submitting}
          className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
        >
          <option value="" disabled>
            เลือกเหตุผล
          </option>
          {PURCHASE_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {PURCHASE_REQUEST_REASON_CODE_LABEL[code]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pr-notes" className="text-ink text-sm font-medium">
          หมายเหตุ (ไม่บังคับ)
        </label>
        <textarea
          id="pr-notes"
          value={notes}
          maxLength={1000}
          rows={3}
          onChange={(e) => {
            setNotes(e.target.value);
            setError(null);
            setSavedAt(null);
          }}
          disabled={submitting}
          className="rounded-control border-edge-strong bg-card text-ink placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
          placeholder="เช่น ยี่ห้อ รุ่น หรือข้อความถึงฝ่ายจัดซื้อ"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-ink text-sm font-medium">รูปและลิงก์อ้างอิง (ไม่บังคับ)</span>
        <PurchaseRequestAttachmentStager
          ref={stagerRef}
          projectId={projectId}
          userId={userId}
          disabled={submitting}
        />
      </div>

      {inlineError ? (
        <div role="alert" className={`${INLINE_ERROR} font-medium`}>
          {inlineError}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {attachmentNote !== null && !submitting ? (
          <span className="text-attn-ink text-xs font-medium" role="status">
            {attachmentNote}
          </span>
        ) : null}
        {savedAt !== null && !submitting ? (
          <span className="text-done-strong text-xs font-medium" role="status">
            {approvedSaved ? "บันทึกและอนุมัติแล้ว" : "บันทึกแล้ว"}
          </span>
        ) : null}
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? "กำลังบันทึก…" : canSelfApprove ? "สร้างและอนุมัติ" : "ส่งคำขอซื้อ"}
        </button>
      </div>
    </form>
  );
}
