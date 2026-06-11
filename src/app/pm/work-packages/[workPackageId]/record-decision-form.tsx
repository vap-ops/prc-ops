"use client";

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
import { recordDecision } from "./actions";

const DECISION_LABEL: Record<ApprovalDecision, string> = {
  approved: "อนุมัติ",
  needs_revision: "ให้แก้ไข",
  rejected: "ไม่อนุมัติ",
};

const DECISION_HINT: Record<ApprovalDecision, string> = {
  approved: "รายการงานจะเปลี่ยนเป็นเสร็จสิ้น",
  needs_revision: "ส่งกลับให้ถ่ายรูปใหม่ — ต้องใส่ความเห็น",
  rejected: "ไม่อนุมัติงานตามที่ส่งมา — ต้องใส่ความเห็น",
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
      // Decision recorded. On 'approved' the WP flips to 'complete'
      // and drops off the queue; on the other two it remains
      // pending_approval with an updated latest-decision label.
      // Either way, the queue is the right landing.
      router.push("/pm");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
    >
      <fieldset className="flex flex-col gap-2" disabled={submitting}>
        <legend className="mb-1 text-sm font-medium text-zinc-200">ผลการตรวจ</legend>
        {APPROVAL_DECISIONS.map((d) => (
          <label
            key={d}
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
              decision === d
                ? "border-zinc-500 bg-zinc-800/60"
                : "border-zinc-800 bg-transparent hover:bg-zinc-900"
            }`}
          >
            <input
              type="radio"
              name="decision"
              value={d}
              checked={decision === d}
              onChange={() => setDecision(d)}
              className="mt-1 accent-zinc-100"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium text-zinc-100">{DECISION_LABEL[d]}</span>
              <span className="text-xs text-zinc-500">{DECISION_HINT[d]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="approval-comment" className="text-sm font-medium text-zinc-200">
          ความเห็น{" "}
          {needsComment ? (
            <span className="text-red-300">*</span>
          ) : (
            <span className="text-zinc-500">(ไม่บังคับ)</span>
          )}
        </label>
        <Textarea
          id="approval-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          required={needsComment}
          disabled={submitting}
          placeholder={needsComment ? "อธิบายสิ่งที่ต้องแก้ไข" : "บันทึกเพิ่มเติม (ถ้ามี)"}
          className="min-h-24 border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-500"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-100 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "กำลังบันทึก…" : "บันทึกผลการตรวจ"}
        </button>
      </div>
    </form>
  );
}
