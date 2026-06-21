"use client";

// Spec 164 U3 — bulk-assign ungrouped งาน to a งวด. 'use client' justified:
// multi-select state, target picker, submit pending, inline error, router.refresh
// to drop the assigned งาน out of the ungrouped list. The
// assignWorkPackagesToDeliverable action (loops set_work_package_deliverable) is
// the load-bearing path. Replaces the 1-WP-at-a-time picker for bulk grouping.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_SELECT, INLINE_ERROR } from "@/lib/ui/classes";
import { assignWorkPackagesToDeliverable } from "./actions";

interface WpRow {
  id: string;
  code: string;
  name: string;
}
interface DeliverableRow {
  id: string;
  code: string;
  name: string;
}

export function GroupWorkPackagesSheet({
  projectId,
  ungroupedWorkPackages,
  deliverables,
}: {
  projectId: string;
  ungroupedWorkPackages: WpRow[];
  deliverables: DeliverableRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const allChecked =
    ungroupedWorkPackages.length > 0 && selected.size === ungroupedWorkPackages.length;
  const canSubmit = target !== "" && selected.size > 0 && !submitting;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === ungroupedWorkPackages.length
        ? new Set()
        : new Set(ungroupedWorkPackages.map((w) => w.id)),
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await assignWorkPackagesToDeliverable(projectId, [...selected], target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
      setTarget("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
        จัดกลุ่มงาน
      </button>

      <BottomSheet open={open} title="จัดกลุ่มงานเข้างวด" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="group-target" className="text-ink text-sm font-medium">
              งวดปลายทาง
            </label>
            <select
              id="group-target"
              aria-label="เลือกงวดปลายทาง"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={submitting}
              className={FIELD_SELECT}
            >
              <option value="">เลือกงวด…</option>
              {deliverables.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="border-edge flex items-center justify-between border-b pb-2">
            <span className="text-ink-secondary text-meta">
              เลือกแล้ว {selected.size}/{ungroupedWorkPackages.length}
            </span>
            <label className="text-ink flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="เลือกทั้งหมด"
                checked={allChecked}
                onChange={toggleAll}
                disabled={submitting}
                className="h-4 w-4"
              />
              เลือกทั้งหมด
            </label>
          </div>

          <ul className="divide-edge max-h-72 divide-y overflow-y-auto">
            {ungroupedWorkPackages.map((w) => (
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
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังย้าย…" : `ย้าย ${selected.size} งาน`}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
