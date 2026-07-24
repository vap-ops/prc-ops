"use client";

import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";

// PM record-decision form. Native radios for the three approval choices
// (no extra shadcn dep), shadcn Textarea for the comment, client-side
// required-comment validation, and submit-disabled when invalid. The
// server action (recordDecision) is the load-bearing validator; this
// form just refuses to send obviously-bad input so the user gets fast
// feedback.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  APPROVAL_DECISIONS,
  commentRequiredFor,
  isCommentValid,
  type ApprovalDecision,
} from "@/lib/approvals/predicates";
import { APPROVAL_DECISION_LABEL } from "@/lib/i18n/labels";
import { recordDecision } from "./actions";

// Spec 353 — the two rejections are sharpened on the evidence-vs-work axis and the
// PM's choice must read the SAME as the SA later sees, so the two rejection labels
// are single-sourced from APPROVAL_DECISION_LABEL. `approved` stays imperative here
// (the form asks the PM to DO it); the result surfaces show "อนุมัติแล้ว".
// needs_revision = re-shoot the photos, the WORK is fine, the WP stays in the queue.
// rejected (spec 337 F3) = the WORK goes back to a new rework round.
const DECISION_LABEL: Record<ApprovalDecision, string> = {
  approved: "อนุมัติ",
  needs_revision: APPROVAL_DECISION_LABEL.needs_revision,
  rejected: APPROVAL_DECISION_LABEL.rejected,
};

const DECISION_HINT: Record<ApprovalDecision, string> = {
  approved: "รายการงานจะเปลี่ยนเป็นเสร็จสิ้น",
  needs_revision:
    "รูปหลักฐานไม่ครบหรือไม่ชัด — ถ่ายใหม่แล้วส่งตรวจอีกครั้ง · ยังอยู่ในคิวตรวจ (งานไม่ต้องแก้)",
  rejected: "ตัวงานต้องแก้ไข — จะกลับไปเป็นงานแก้ไข (รอบใหม่) แล้วถ่ายรูปหลังแก้ไข",
};

interface RecordDecisionFormProps {
  workPackageId: string;
}

export function RecordDecisionForm({ workPackageId }: RecordDecisionFormProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const needsComment = decision ? commentRequiredFor(decision) : false;
  const canSubmit =
    decision !== null && isCommentValid(decision, comment.length ? comment : null) && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!decision) return;
    setError(null);
    startSubmit(async () => {
      const result = await recordDecision({
        workPackageId,
        decision,
        comment: comment.length > 0 ? comment : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Decision recorded. 'approved' flips the WP to 'complete' and 'rejected'
      // flips it to 'rework' (spec 337 F3) — both drop off the queue;
      // 'needs_revision' stays pending_approval awaiting the SA's re-shoot,
      // with an updated latest-decision label. Either way, the queue is the
      // right landing.
      router.push("/review");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-card border-edge bg-card shadow-card flex flex-col gap-4 border p-5"
    >
      <fieldset className="flex flex-col gap-2" disabled={submitting}>
        <legend className="text-ink mb-1 text-sm font-medium">ผลการตรวจ</legend>
        {APPROVAL_DECISIONS.map((d) => (
          <label
            key={d}
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
              decision === d
                ? "border-action bg-action-soft"
                : "border-edge-strong bg-card hover:bg-page"
            }`}
          >
            <input
              type="radio"
              name="decision"
              value={d}
              checked={decision === d}
              onChange={() => setDecision(d)}
              className="accent-fill mt-1"
            />
            <span className="flex flex-col">
              <span className="text-ink text-sm font-medium">{DECISION_LABEL[d]}</span>
              <span className="text-ink-secondary text-xs">{DECISION_HINT[d]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="approval-comment" className="text-ink text-sm font-medium">
          ความเห็น{" "}
          {needsComment ? (
            <span className="text-danger">*</span>
          ) : (
            <span className="text-ink-secondary">(ไม่บังคับ)</span>
          )}
        </label>
        <Textarea
          id="approval-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          required={needsComment}
          disabled={submitting}
          placeholder={needsComment ? "อธิบายสิ่งที่ต้องแก้ไข" : "บันทึกเพิ่มเติม (ถ้ามี)"}
          className="border-edge-strong bg-card text-ink placeholder:text-ink-muted min-h-24"
        />
      </div>

      {error && (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? "กำลังบันทึก…" : "บันทึกผลการตรวจ"}
        </button>
      </div>
    </form>
  );
}
