"use client";

// WP schedule panel (spec 92 Unit C) — PM/super set the planned window and the
// finish-to-start predecessors ("ขึ้นกับ" / depends-on). These feed the
// critical-path computation that lights the worklist วิกฤต badge. Rendered for
// PM/super on the WP detail page. Cycle/same-project rejection is server-side
// (the RPC); a rejected add surfaces as a toast.

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { useToast } from "@/lib/ui/use-toast";
import {
  setWorkPackageSchedule,
  addWorkPackageDependency,
  removeWorkPackageDependency,
} from "@/app/projects/[projectId]/work-packages/[workPackageId]/schedule-actions";

export interface WpOption {
  id: string;
  code: string;
  name: string;
}

interface WpSchedulePanelProps {
  projectId: string;
  workPackageId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  /** Current predecessors (this WP depends on them). */
  predecessors: WpOption[];
  /** Selectable predecessors (same project, not self, not already a dep). */
  candidates: WpOption[];
}

const FIELD =
  "h-11 rounded-control border border-edge-strong bg-card px-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-action";

export function WpSchedulePanel({
  projectId,
  workPackageId,
  plannedStart,
  plannedEnd,
  predecessors,
  candidates,
}: WpSchedulePanelProps) {
  const [start, setStart] = useState(plannedStart ?? "");
  const [end, setEnd] = useState(plannedEnd ?? "");
  const [pickerValue, setPickerValue] = useState("");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function saveSchedule() {
    startTransition(async () => {
      const r = await setWorkPackageSchedule({
        projectId,
        workPackageId,
        start: start || null,
        end: end || null,
      });
      toast.fromResult(r, "บันทึกกำหนดการแล้ว");
    });
  }

  function addDep(predecessorId: string) {
    if (!predecessorId) return;
    startTransition(async () => {
      const r = await addWorkPackageDependency({ projectId, workPackageId, predecessorId });
      toast.fromResult(r, "เพิ่มงานที่ต้องทำก่อนแล้ว");
      if (r.ok) setPickerValue("");
    });
  }

  function removeDep(predecessorId: string) {
    startTransition(async () => {
      const r = await removeWorkPackageDependency({ projectId, workPackageId, predecessorId });
      toast.fromResult(r, "เอาออกแล้ว");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Planned window */}
      <div className="flex flex-col gap-1.5">
        <p className="text-meta text-ink-secondary font-semibold">กำหนดการ (แผน)</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-meta text-ink-secondary flex flex-col gap-1">
            เริ่ม
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={FIELD}
            />
          </label>
          <label className="text-meta text-ink-secondary flex flex-col gap-1">
            สิ้นสุด
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className={FIELD}
            />
          </label>
          <button
            type="button"
            onClick={saveSchedule}
            disabled={pending}
            className="rounded-control bg-fill text-on-fill hover:bg-fill-press focus-visible:ring-action h-11 px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50"
          >
            บันทึก
          </button>
        </div>
      </div>

      {/* Finish-to-start predecessors */}
      <div className="flex flex-col gap-1.5">
        <p className="text-meta text-ink-secondary font-semibold">ต้องทำหลังจากงาน (ขึ้นกับ)</p>
        {predecessors.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {predecessors.map((p) => (
              <li
                key={p.id}
                className="border-edge bg-sunk text-meta text-ink inline-flex items-center gap-1 rounded-full border py-1 pr-1 pl-2"
              >
                <span className="text-ink-secondary font-mono">{p.code}</span>
                <span className="line-clamp-1 max-w-[12rem]">{p.name}</span>
                <button
                  type="button"
                  aria-label={`เอา ${p.code} ออก`}
                  onClick={() => removeDep(p.id)}
                  disabled={pending}
                  className="text-ink-muted hover:text-danger inline-flex h-5 w-5 items-center justify-center rounded-full disabled:opacity-50"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-ink-muted">ยังไม่มี</p>
        )}
        {candidates.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              value={pickerValue}
              onChange={(e) => setPickerValue(e.target.value)}
              aria-label="เลือกงานที่ต้องทำก่อน"
              className={`${FIELD} flex-1 appearance-none`}
            >
              <option value="">เลือกงานที่ต้องทำก่อน…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => addDep(pickerValue)}
              disabled={pending || !pickerValue}
              className="rounded-control border-edge-strong bg-card text-ink hover:bg-sunk focus-visible:ring-action inline-flex h-11 items-center gap-1 border px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              <Plus aria-hidden className="h-4 w-4" /> เพิ่ม
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
