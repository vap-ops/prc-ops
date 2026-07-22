"use client";

// Spec 337 U2a (F2) — "ส่งตรวจอีกครั้ง": the SA's explicit answer to a
// needs_revision. The PM's ask is free text, so only the SA knows when it has
// been satisfied; pressing this is what pings the DECIDER (a person, not the
// approval pool) and lifts the item out of the queue's "waiting on photos" half.
//
// 'use client' justified: sheet open state, submit pending, inline error,
// router.refresh once the resubmit lands. All of the visibility/enablement logic
// lives in resubmitState (server-computed and passed in) so this component holds
// no rule of its own — the server action refuses from the same function.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { RESUBMIT_DONE_NOTE, RESUBMIT_LABEL, type ResubmitState } from "@/lib/approvals/resubmit";
import { resubmitWorkPackageEvidence } from "./actions";

export function ResubmitEvidenceControl({
  projectId,
  workPackageId,
  state,
}: {
  projectId: string;
  workPackageId: string;
  state: ResubmitState;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function handleSubmit() {
    if (submitting) return;
    setError(null);
    startSubmit(async () => {
      const result = await resubmitWorkPackageEvidence({ projectId, workPackageId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (state.kind === "hidden") return null;

  // Answered already: the RPC is idempotent per decision, so a button here could
  // only ever error. Say what happened instead.
  if (state.kind === "done") {
    return <p className="text-ink-secondary text-meta text-right">{RESUBMIT_DONE_NOTE}</p>;
  }

  const blocked = state.kind === "blocked";

  return (
    <>
      <div className="flex flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={blocked}
          aria-describedby={blocked ? "resubmit-evidence-hint" : undefined}
          className={BUTTON_PRIMARY}
        >
          {RESUBMIT_LABEL}
        </button>
        {blocked ? (
          <p id="resubmit-evidence-hint" className="text-ink-secondary text-meta">
            {state.hint}
          </p>
        ) : null}
      </div>

      <BottomSheet open={open} title={RESUBMIT_LABEL} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-ink-secondary text-sm">
            แจ้งผู้จัดการที่ให้แก้ไขว่าถ่ายรูปเพิ่มแล้ว — งานจะกลับไปอยู่ในคิวรอตรวจอีกครั้ง
          </p>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังส่ง…" : RESUBMIT_LABEL}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
