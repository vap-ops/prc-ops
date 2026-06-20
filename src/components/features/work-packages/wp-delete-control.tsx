"use client";

// Spec 157 / ADR 0059 — WP delete control (Tier 1: empty-only). PM/super/director
// hard-delete a WP created by mistake. Guarded by the themed ConfirmDialog (no
// window.confirm, ui-conventions §7). On success the WP is gone, so it navigates
// to the project page (router.refresh would 404 the deleted page). A WP with
// history is refused by the RPC (P0001) → the action returns the "cancel instead"
// message, shown inline. The parent renders this for managers only.
//
// 'use client' justified: dialog open state + pending state + navigation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { projectHref } from "@/lib/nav/project-paths";
import { deleteWorkPackage } from "@/app/projects/[projectId]/work-packages/[workPackageId]/delete-actions";

interface WpDeleteControlProps {
  projectId: string;
  workPackageId: string;
}

const DELETE_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-lg border border-edge-strong bg-card px-3 text-sm font-medium text-danger shadow-xs transition-colors hover:bg-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60";

export function WpDeleteControl({ projectId, workPackageId }: WpDeleteControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await deleteWorkPackage({ projectId, workPackageId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(projectHref(projectId));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className={DELETE_BUTTON}
      >
        {pending ? "กำลังลบ…" : "ลบงาน"}
      </button>
      {error ? <p className={INLINE_ALERT_TEXT}>{error}</p> : null}
      <ConfirmDialog
        open={open}
        message="ลบงานนี้ถาวรหรือไม่? ทำได้เฉพาะงานที่ยังไม่มีรูป แรงงาน หรือคำขอซื้อ"
        confirmLabel="ลบถาวร"
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
