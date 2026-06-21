"use client";

// Spec 165 U1 — rename a งวด from the manager row. 'use client' justified:
// controlled input, sheet open state, submit pending, inline error,
// router.refresh to surface the new name. The setDeliverableName action (and the
// membership-gated set_deliverable_name RPC beneath it) are the load-bearing
// validators. code is shown read-only (immutable, like a WP code).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { DELIVERABLE_NAME_MAX } from "@/lib/deliverables/validate-new-deliverable";
import { setDeliverableName } from "./actions";

const LABEL = "text-sm font-medium text-ink";

export function EditDeliverableSheet({
  projectId,
  deliverableId,
  code,
  name,
}: {
  projectId: string;
  deliverableId: string;
  code: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const trimmed = value.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= DELIVERABLE_NAME_MAX && trimmed !== name && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await setDeliverableName({ projectId, deliverableId, name: trimmed });
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
      <button
        type="button"
        aria-label={`แก้ไขงวด ${code}`}
        onClick={() => setOpen(true)}
        className="text-ink-secondary hover:bg-sunk hover:text-ink rounded-control focus-visible:ring-action inline-flex h-9 w-9 shrink-0 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2"
      >
        <Pencil aria-hidden className="size-4" />
      </button>

      <BottomSheet open={open} title="แก้ไขงวดงาน" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>รหัสงวด</span>
            <span className="text-ink-secondary text-body font-mono">{code}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-deliverable-name" className={LABEL}>
              ชื่องวด
            </label>
            <Input
              id="edit-deliverable-name"
              value={value}
              maxLength={DELIVERABLE_NAME_MAX}
              onChange={(e) => setValue(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11"
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
