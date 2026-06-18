"use client";

// Spec 142 U7 — import work packages from pasted CSV. 'use client' justified:
// controlled textarea, sheet open state, submit pending, inline (multi-line)
// errors, router.refresh to surface the imported WPs. The importWorkPackagesCsv
// action (wp-import parser + create_work_package RPC) is the load-bearing path.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { importWorkPackagesCsv } from "./actions";

const LABEL = "text-sm font-medium text-ink";

export function ImportWorkPackagesSheet({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit = csv.trim() !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await importWorkPackagesCsv(projectId, csv);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCsv("");
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
        นำเข้า CSV
      </button>

      <BottomSheet open={open} title="นำเข้างานจาก CSV" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-wp-csv" className={LABEL}>
              วางข้อมูล CSV
            </label>
            <textarea
              id="import-wp-csv"
              value={csv}
              rows={8}
              onChange={(e) => setCsv(e.target.value)}
              disabled={submitting}
              className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2"
              placeholder={"code,name,description\nWP-001,งานวางท่อ,รายละเอียด\nWP-002,งานเทพื้น,"}
            />
            <p className="text-ink-muted text-xs">
              บรรทัดแรกเป็นหัวตาราง: code,name,description
              รหัสที่มีอยู่แล้วหรือซ้ำในไฟล์จะถูกแจ้งเตือน
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
