"use client";

// Spec 165 U4 — delete an EMPTY งวด from its detail page. Guarded by the themed
// ConfirmDialog (no window.confirm, ui-conventions §7). On success the งวด is
// gone → navigate to the project's งวดงาน section (router.refresh would 404 the
// deleted page). A populated งวด is refused by the RPC (P0001) → the message is
// shown inline. Mirrors WpDeleteControl. The parent renders this for managers
// only, and only when the งวด has no งาน.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { projectHref } from "@/lib/nav/project-paths";
import { deleteDeliverable } from "./actions";

const DELETE_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-lg border border-edge-strong bg-card px-3 text-sm font-medium text-danger shadow-xs transition-colors hover:bg-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60";

export function DeleteDeliverableButton({
  projectId,
  deliverableId,
}: {
  projectId: string;
  deliverableId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await deleteDeliverable({ projectId, deliverableId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${projectHref(projectId)}#deliverables`);
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
        {pending ? "กำลังลบ…" : "ลบงวด"}
      </button>
      {error ? <p className={INLINE_ALERT_TEXT}>{error}</p> : null}
      <ConfirmDialog
        open={open}
        message="ลบงวดนี้ถาวรหรือไม่? ทำได้เฉพาะงวดที่ไม่มีงานแล้ว"
        confirmLabel="ลบถาวร"
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
