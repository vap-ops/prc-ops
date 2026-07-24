"use client";

// Spec 352 — "ถอนงานกลับมาแก้ไข": the honest inverse of ส่งงานเข้าตรวจ. The
// submitter (or super_admin) pulls a submitted WP back OUT of review to
// in_progress so the existing remove/add-photo flow can fix misplaced evidence,
// then re-submits. 'use client' justified: sheet open state, pending transition,
// inline error, router.refresh after the WP flips to in_progress. The
// recallWorkPackageSubmission action carries the role gate; the page renders
// this control only when load-detail's canRecall is true (status pending_approval
// + window closed + caller is the submitter or super_admin — the DB predicate).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { recallWorkPackageSubmission } from "./actions";

export function RecallSubmissionControl({
  projectId,
  workPackageId,
}: {
  projectId: string;
  workPackageId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalling, startRecall] = useTransition();

  function handleRecall() {
    if (recalling) return;
    setError(null);
    startRecall(async () => {
      const result = await recallWorkPackageSubmission({ projectId, workPackageId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
        ถอนงานกลับมาแก้ไข
      </button>

      <BottomSheet open={open} title="ถอนงานกลับมาแก้ไข" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-ink-secondary text-sm">
            ถอนงานนี้ออกจากการตรวจ — สถานะจะกลับเป็น “กำลังทำ” เพื่อแก้ไขรูปที่วางผิด
            แล้วส่งตรวจใหม่อีกครั้ง
          </p>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleRecall}
              disabled={recalling}
              className={BUTTON_PRIMARY}
            >
              {recalling ? "กำลังถอน…" : "ถอนกลับมาแก้ไข"}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
