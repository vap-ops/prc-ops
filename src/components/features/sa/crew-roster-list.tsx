// SA crew/onboarding page — the roster list. The SA's project workers by name
// (name only; money columns are zero-grant and never read here). When empty it
// shows an onboarding hint that points at the QR below it — closing the loop:
// scan → self-register → approve → the person appears here.

import { EmptyNotice } from "@/components/features/common/notices";

export interface CrewRosterRow {
  id: string;
  name: string;
  /** Shown only when the SA runs more than one project. */
  projectLabel?: string;
  /** cost_confirmed_at is null — added but a PM has not confirmed pay/level yet. */
  pending?: boolean;
}

export function CrewRosterList({ workers }: { workers: CrewRosterRow[] }) {
  if (workers.length === 0) {
    return (
      <EmptyNotice>
        ยังไม่มีช่างในระบบ — เพิ่มเองด้านล่าง หรือให้ช่างสแกน QR เพื่อสมัคร
        แล้วอนุมัติในหน้าคำขอสมัคร
      </EmptyNotice>
    );
  }
  return (
    <ul className="rounded-card border-edge bg-card shadow-card flex flex-col border px-4">
      {workers.map((w) => (
        <li
          key={w.id}
          className="border-edge text-ink flex min-h-11 items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0"
        >
          <span className="min-w-0 truncate font-medium">{w.name}</span>
          <span className="flex shrink-0 items-center gap-2">
            {w.pending ? (
              <span className="border-attn-edge bg-attn-soft text-attn-ink text-meta rounded-full border px-2 py-0.5">
                รอยืนยัน
              </span>
            ) : null}
            {w.projectLabel ? (
              <span className="text-ink-muted text-meta">{w.projectLabel}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
