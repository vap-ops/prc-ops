"use client";

// Spec 284 U5 / ADR 0080 — the document-decision form on the /legal/approvals
// queue. 'use client': controlled comment + useTransition + router.refresh after
// the decision. A REQUIRED comment gates every decision (approve / reject /
// needs_revision) — submit_document_decision (U4) rejects a blank comment
// server-side; the UI mirrors that (buttons stay disabled). It relays U4's
// submitDocumentDecision (SECURITY DEFINER, DOC_APPROVAL_ROLES); an 'approve'
// flips the contract draft→active in the same txn, so the row leaves the queue.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DocumentDecision } from "@/lib/db/enums";
import { submitDocumentDecision } from "@/lib/legal/approvals";
import { DOCUMENT_DECISION_LABEL } from "@/lib/i18n/labels";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  FIELD_STACKED,
  INLINE_ERROR,
} from "@/lib/ui/classes";

const DECISIONS: ReadonlyArray<DocumentDecision> = ["approve", "reject", "needs_revision"];

export function DocumentDecisionForm({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit = comment.trim().length > 0 && !pending;

  function decide(decision: DocumentDecision) {
    setError(null);
    startTransition(async () => {
      const r = await submitDocumentDecision({ contractId, decision, comment: comment.trim() });
      if (r.ok) {
        setComment("");
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-ink-secondary text-xs">
        ความเห็น (จำเป็น)
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className={FIELD_STACKED}
          placeholder="ระบุเหตุผลของการพิจารณา"
        />
      </label>
      {error ? (
        <p role="alert" className={INLINE_ERROR}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={!canSubmit}
            onClick={() => decide(d)}
            className={d === "approve" ? BUTTON_PRIMARY_COMPACT : BUTTON_SECONDARY_COMPACT}
          >
            {DOCUMENT_DECISION_LABEL[d]}
          </button>
        ))}
      </div>
    </div>
  );
}
