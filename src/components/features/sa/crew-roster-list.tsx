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
}

export function CrewRosterList({ workers }: { workers: CrewRosterRow[] }) {
  if (workers.length === 0) {
    return (
      <EmptyNotice>
        ยังไม่มีช่างในระบบ — ให้ช่างสแกน QR ด้านล่างเพื่อสมัคร แล้วอนุมัติในหน้าคำขอสมัคร
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
          {w.projectLabel ? (
            <span className="text-ink-muted text-meta shrink-0">{w.projectLabel}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
