// Spec 350 U2 — the /technician "งานที่ได้รับมอบหมาย" card. Read-only display of
// the technician's most-recent muster team's work (from get_my_assigned_work, U1)
// with each WP's status + the parent งาน's progress. Server Component; no actions.

import { StatusPill } from "@/components/features/common/status-pill";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { workPackageStatusIcon } from "@/lib/status-icons";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";
import type { AssignedWorkView } from "@/lib/technician/assigned-work-view";

export function AssignedWorkCard({ view }: { view: AssignedWorkView }) {
  const bangkokToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
    new Date(),
  );
  const dateLabel = view.workDate === bangkokToday ? "วันนี้" : view.workDate;

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-ink text-sm font-semibold">งานที่ได้รับมอบหมาย</p>
        {view.workDate ? <span className="text-ink-muted text-meta">{dateLabel}</span> : null}
      </div>

      {view.rows.length === 0 ? (
        <p className="text-ink-secondary mt-1 text-sm">ยังไม่มีงานที่ได้รับมอบหมาย</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {view.rows.map((r) => (
            <li key={r.wpId} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <StatusPill
                  pillClasses={workPackageStatusPillClasses(r.status)}
                  icon={workPackageStatusIcon(r.status)}
                >
                  {WORK_PACKAGE_STATUS_LABEL[r.status] ?? r.status}
                </StatusPill>
                <span className="text-ink text-sm font-medium">{r.code}</span>
                <span className="text-ink-secondary min-w-0 truncate text-sm">{r.name}</span>
              </div>
              {r.groupProgress ? (
                <p className="text-ink-muted text-meta">
                  {r.parentName
                    ? `อยู่ในงาน ${r.parentName} · ${r.groupProgress.percent}%`
                    : `${r.groupProgress.percent}% (${r.groupProgress.completeCount}/${r.groupProgress.totalCount} งานย่อย เสร็จ)`}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
