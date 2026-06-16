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
import { createPurchaseRequest } from "@/app/requests/actions";
import {
  PurchaseRequestAttachmentStager,
  type AttachmentStagerHandle,
} from "@/components/features/purchasing/purchase-request-attachment-stager";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";
import {
  PURCHASE_PRIORITIES,
  validateCreatePurchaseRequest,
  type PurchasePriority,
} from "@/lib/purchasing/validate-purchase-request";
import { PURCHASE_REQUEST_PRIORITY_LABEL } from "@/lib/i18n/labels";
import { bangkokTodayIso } from "@/lib/dates";

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
}

export function PurchaseRequestForm({ workPackage, projectId, userId }: PurchaseRequestFormProps) {
  const router = useRouter();
  const [itemDescription, setItemDescription] = useState<string>("");
  const [quantityText, setQuantityText] = useState<string>("");
  // Unit = dropdown of COMMON_UNITS + the อื่น ๆ sentinel revealing a
  // free-text input (spec 16 §1). The derived `unit` string is what the
  // validator/action/DB see — the sentinel is never persisted.
  const [unitChoice, setUnitChoice] = useState<string>("");
  const [unitOther, setUnitOther] = useState<string>("");
  const [neededBy, setNeededBy] = useState<string>("");
  const [priority, setPriority] = useState<PurchasePriority>("normal");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [attachmentNote, setAttachmentNote] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const stagerRef = useRef<AttachmentStagerHandle>(null);

  const unit = unitChoice === UNIT_OTHER_VALUE ? unitOther : unitChoice;

  // Quantity is a numeric column at the DB and the validator wants a
  // finite positive number. The input is a free-text field so users can
  // type "12.5", "0.5", etc.; parseFloat returns NaN for empties /
  // garbage, which the validator then rejects cleanly.
  const quantity = quantityText.trim().length === 0 ? Number.NaN : Number.parseFloat(quantityText);

  const localValidation = validateCreatePurchaseRequest({
    workPackageId: workPackage.id,
    itemDescription,
    quantity,
    unit,
    neededBy: neededBy.length > 0 ? neededBy : null,
    priority,
    notes: notes.length > 0 ? notes : null,
  });
  const canSubmit = !submitting && localValidation.ok;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSavedAt(null);
    startSubmit(async () => {
      const result = await createPurchaseRequest({
        workPackageId: workPackage.id,
        itemDescription,
        quantity,
        unit,
        neededBy: neededBy.length > 0 ? neededBy : null,
        priority,
        notes: notes.length > 0 ? notes : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Staged attachments flush AFTER the request exists; failures never
      // roll back the request (spec 16 §4) — failed items stay in the
      // stager with ลองใหม่ and a note appears beside บันทึกแล้ว.
      const failedAttachments = (await stagerRef.current?.flush(result.id)) ?? 0;
      setAttachmentNote(
        failedAttachments > 0 ? "บางรายการแนบไม่สำเร็จ — กดลองใหม่ในรายการด้านบน" : null,
      );
      // Pessimistic confirmation: only after the round-trip succeeded.
      // Clear the inputs so the form is ready for the next request on the
      // same WP; the router.refresh() re-runs the Server Component so the
      // list picks up the new row.
      setItemDescription("");
      setQuantityText("");
      setUnitChoice("");
      setUnitOther("");
      setNeededBy("");
      setPriority("normal");
      setNotes("");
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  // Inline validation only after the user has touched the field (any
  // non-empty input; a unit selection counts — spec 16 §1). Same shape
  // as DisplayNameForm — keeps an untouched form quiet. The pinned WP id
  // never counts as "typed".
  const userTyped =
    itemDescription.length > 0 ||
    quantityText.length > 0 ||
    unitChoice.length > 0 ||
    unitOther.length > 0 ||
    neededBy.length > 0 ||
    notes.length > 0;
  const inlineError = error ?? (!localValidation.ok && userTyped ? localValidation.error : null);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-control border-edge-strong bg-page shadow-card flex flex-col gap-3 border p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-ink text-sm font-medium">รายการงาน</span>
        <p className="border-edge-strong bg-card truncate rounded-md border px-3 py-2 text-sm">
          <span className="text-ink-secondary font-mono">{workPackage.code}</span>
          <span className="text-ink-muted mx-1">·</span>
          <span className="text-ink">{workPackage.name}</span>
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pr-item" className="text-ink text-sm font-medium">
          รายการวัสดุ
        </label>
        <input
          id="pr-item"
          type="text"
          value={itemDescription}
          maxLength={500}
          onChange={(e) => {
            setItemDescription(e.target.value);
            setError(null);
            setSavedAt(null);
          }}
          disabled={submitting}
          className={FIELD_INPUT}
          placeholder="ปูนถุง 50 กก."
        />
      </div>

      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
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
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="pr-unit" className="text-ink text-sm font-medium">
            หน่วย
          </label>
          <select
            id="pr-unit"
            value={unitChoice}
            onChange={(e) => {
              setUnitChoice(e.target.value);
              setError(null);
              setSavedAt(null);
            }}
            disabled={submitting}
            className="rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
          >
            <option value="" disabled>
              เลือกหน่วย
            </option>
            {COMMON_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
            <option value={UNIT_OTHER_VALUE}>อื่น ๆ (ระบุเอง)</option>
          </select>
        </div>
      </div>

      {unitChoice === UNIT_OTHER_VALUE ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="pr-unit-other" className="text-ink text-sm font-medium">
            ระบุหน่วย
          </label>
          <input
            id="pr-unit-other"
            type="text"
            value={unitOther}
            maxLength={50}
            onChange={(e) => {
              setUnitOther(e.target.value);
              setError(null);
              setSavedAt(null);
            }}
            disabled={submitting}
            className={FIELD_INPUT}
            placeholder="ระบุหน่วย"
          />
        </div>
      ) : null}

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
            บันทึกแล้ว
          </span>
        ) : null}
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? "กำลังส่ง…" : "ส่งคำขอซื้อ"}
        </button>
      </div>
    </form>
  );
}
