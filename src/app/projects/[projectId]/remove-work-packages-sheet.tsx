"use client";

// Spec 165 U4 — remove (ungroup) งาน from a งวด, so the งวด can be emptied and
// deleted. 'use client' justified: multi-select state, submit pending, inline
// error, router.refresh to drop the removed งาน out of the list. The
// removeWorkPackagesFromDeliverable action loops set_work_package_deliverable
// with a NULL deliverable (= ungroup). Mirrors GroupWorkPackagesSheet.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { removeWorkPackagesFromDeliverable } from "./actions";

interface WpRow {
  id: string;
  code: string;
  name: string;
}

const DANGER_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-control border border-edge-strong bg-card px-4 text-body font-medium text-danger shadow-input transition-colors hover:bg-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60";

export function RemoveWorkPackagesSheet({
  projectId,
  workPackages,
}: {
  projectId: string;
  workPackages: WpRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit = selected.size > 0 && !submitting;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await removeWorkPackagesFromDeliverable(projectId, [...selected]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
        เอางานออกจากงวด
      </button>

      <BottomSheet open={open} title="เอางานออกจากงวด" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-ink-secondary text-sm">
            งานที่เอาออกจะกลับไปอยู่ “ยังไม่จัดกลุ่ม” (ไม่ถูกลบ) — เอางานออกจนหมดเพื่อลบงวด
          </p>

          <ul className="divide-edge max-h-72 divide-y overflow-y-auto">
            {workPackages.map((w) => (
              <li key={w.id}>
                <label className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`${w.code} ${w.name}`}
                    checked={selected.has(w.id)}
                    onChange={() => toggle(w.id)}
                    disabled={submitting}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="text-ink-secondary text-meta shrink-0 font-mono">{w.code}</span>
                  <span className="text-ink text-body min-w-0 flex-1 truncate">{w.name}</span>
                </label>
              </li>
            ))}
          </ul>

          {error && (
            <div role="alert" className={`${INLINE_ERROR} whitespace-pre-line`}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={DANGER_BUTTON}>
              {submitting ? "กำลังเอาออก…" : `เอาออก ${selected.size} งาน`}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
