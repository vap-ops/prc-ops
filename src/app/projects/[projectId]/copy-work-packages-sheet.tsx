"use client";

// Spec 142 U6 — copy work packages from another project. 'use client' justified:
// controlled select, sheet open state, submit pending, inline error/result,
// router.refresh to surface the cloned WPs. The copyWorkPackages action (and the
// SECURITY DEFINER clone_work_packages RPC) are the load-bearing validators. The
// source list is RLS-scoped upstream — a PM only sees projects they're on.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { copyWorkPackages } from "./actions";

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";

interface SourceProject {
  id: string;
  code: string;
  name: string;
}

export function CopyWorkPackagesSheet({
  projectId,
  sourceProjects,
}: {
  projectId: string;
  sourceProjects: SourceProject[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit = sourceId !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await copyWorkPackages(sourceId, projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSourceId("");
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
        คัดลอกงาน
      </button>

      <BottomSheet open={open} title="คัดลอกงานจากโครงการอื่น" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="copy-wp-source" className={LABEL}>
              โครงการต้นทาง
            </label>
            <select
              id="copy-wp-source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              disabled={submitting || sourceProjects.length === 0}
              className={FIELD}
            >
              <option value="">— เลือกโครงการ —</option>
              {sourceProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
            <p className="text-ink-muted text-xs">
              คัดลอกเฉพาะรหัส/ชื่อ/รายละเอียดงาน รหัสที่มีอยู่แล้วจะถูกข้าม
            </p>
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังคัดลอก…" : "คัดลอก"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
