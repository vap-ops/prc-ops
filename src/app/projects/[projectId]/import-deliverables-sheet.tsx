"use client";

// Spec 164 U2 — bulk-paste a งวด list (from the operator's separate งวด tab).
// 'use client' justified: controlled textarea, sheet open state, submit pending,
// inline (multi-line) errors, router.refresh to surface the new งวด. The
// importDeliverables action (spec-163 parser + create_deliverable RPC) is the
// load-bearing path. Mirrors ImportWorkPackagesSheet.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { importDeliverables } from "./actions";

const LABEL = "text-sm font-medium text-ink";

export function ImportDeliverablesSheet({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit = text.trim() !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await importDeliverables(projectId, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-edge-strong text-ink hover:bg-sunk focus-visible:ring-action rounded-control bg-card text-body inline-flex h-11 items-center border px-4 font-medium transition-colors focus:outline-none focus-visible:ring-2 active:translate-y-px"
      >
        วางรายการงวด
      </button>

      <BottomSheet open={open} title="วางรายการงวดงาน" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-deliverables" className={LABEL}>
              วางข้อมูลงวด
            </label>
            <textarea
              id="import-deliverables"
              value={text}
              rows={8}
              onChange={(e) => setText(e.target.value)}
              disabled={submitting}
              className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2"
              placeholder={"D01\tงานเตรียมพื้นที่\nD05\tงานโครงสร้าง\n\n(หรือ CSV: code,name)"}
            />
            <p className="text-ink-muted text-xs">
              คัดลอกช่องรหัสและชื่องวดจากชีตมาวางได้เลย (ไม่ต้องมีหัวตาราง) •
              รหัสที่ซ้ำหรือมีอยู่แล้วจะถูกแจ้งเตือน
            </p>
          </div>

          {error && (
            <div role="alert" className={`${INLINE_ERROR} whitespace-pre-line`}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังนำเข้า…" : "นำเข้า"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
