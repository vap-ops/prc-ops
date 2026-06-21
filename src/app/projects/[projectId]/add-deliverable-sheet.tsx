"use client";

// Spec 164 U1 — the "add งวดงาน" sheet on the project page. 'use client'
// justified: controlled inputs, sheet open state, submit pending, inline error,
// router.refresh to surface the new งวด. The createDeliverable server action
// (and the SECURITY DEFINER create_deliverable RPC beneath it) are the
// load-bearing validators. Mirrors AddWorkPackageSheet (Spec 142 U4).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import {
  DELIVERABLE_CODE_MAX,
  DELIVERABLE_NAME_MAX,
  validateDeliverableCode,
  validateDeliverableName,
} from "@/lib/deliverables/validate-new-deliverable";
import { createDeliverable } from "./actions";

const LABEL = "text-sm font-medium text-ink";

export function AddDeliverableSheet({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit =
    validateDeliverableCode(code).ok && validateDeliverableName(name).ok && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createDeliverable({ projectId, code, name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode("");
      setName("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        + เพิ่มงวด
      </button>

      <BottomSheet open={open} title="เพิ่มงวดงาน" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-deliverable-code" className={LABEL}>
              รหัสงวด
            </label>
            <Input
              id="new-deliverable-code"
              value={code}
              maxLength={DELIVERABLE_CODE_MAX}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 font-mono"
              placeholder="เช่น D01"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-deliverable-name" className={LABEL}>
              ชื่องวด
            </label>
            <Input
              id="new-deliverable-name"
              value={name}
              maxLength={DELIVERABLE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11"
              placeholder="เช่น งานเตรียมพื้นที่"
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังเพิ่ม…" : "สร้างงวด"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
