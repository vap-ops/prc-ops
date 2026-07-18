// Spec 327 U3 — the สัปดาห์นี้ radar: what lands this week × what work runs
// this week, side by side so a procurement eye catches the collision. Arrivals
// open their PR (§0.2); WP rows open the WP detail. Server component.

import Link from "next/link";

import { EmptyNotice } from "@/components/features/common/notices";
import { formatThaiDate, INCOMING_LENS_LABEL, THIS_WEEK_LABEL } from "@/lib/i18n/labels";
import { withBackFrom } from "@/lib/nav/back-href";
import { workPackageHref } from "@/lib/nav/project-paths";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import type { TimeViewWp } from "@/lib/purchasing/load-time-view";
import type { TimePrRow } from "@/lib/purchasing/time-view";

const TIME_FROM = "/procurement/time?view=week";

export function TimeWeekRadar({
  projectId,
  week,
  arrivals,
  weekWps,
}: {
  projectId: string;
  /** Sunday-first 7 ISO dates (weekOf). */
  week: ReadonlyArray<string>;
  arrivals: ReadonlyArray<TimePrRow>;
  weekWps: ReadonlyArray<TimeViewWp & { startsThisWeek: boolean }>;
}) {
  const first = week[0];
  const last = week[week.length - 1];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-secondary text-meta">
        {THIS_WEEK_LABEL}: {first ? formatThaiDate(first) : ""} – {last ? formatThaiDate(last) : ""}
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="text-body text-ink-secondary font-semibold">
          ของเข้า{THIS_WEEK_LABEL} ({arrivals.length})
        </h3>
        {arrivals.length === 0 ? (
          <EmptyNotice>ไม่มีของ{INCOMING_LENS_LABEL.onroute}ถึงในสัปดาห์นี้</EmptyNotice>
        ) : (
          <div className="flex flex-col gap-2">
            {arrivals.map((a) => (
              <Link
                key={a.id}
                href={withBackFrom(`/requests/${a.id}`, TIME_FROM)}
                className="rounded-card shadow-card border-edge bg-card text-ink hover:bg-sunk flex min-h-11 items-center gap-3 border px-4 py-3"
              >
                <span className="text-ink-muted shrink-0 font-mono text-xs">
                  {formatPrNumber(a.prNumber)}
                </span>
                <span className="text-body min-w-0 flex-1 truncate">{a.itemDescription}</span>
                <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                  ถึง {formatThaiDate(a.eta!)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-body text-ink-secondary font-semibold">
          งานที่ทำ{THIS_WEEK_LABEL} ({weekWps.length})
        </h3>
        {weekWps.length === 0 ? (
          <EmptyNotice>ไม่มีงานที่มีกำหนดทำในสัปดาห์นี้</EmptyNotice>
        ) : (
          <div className="flex flex-col gap-2">
            {weekWps.map((w) => (
              <Link
                key={w.id}
                href={withBackFrom(workPackageHref(projectId, w.id), TIME_FROM)}
                className="rounded-card shadow-card border-edge bg-card text-ink hover:bg-sunk flex min-h-11 items-center gap-3 border px-4 py-3"
              >
                <span className="text-body min-w-0 flex-1 truncate font-semibold">{w.name}</span>
                {w.startsThisWeek && w.plannedStart ? (
                  <span className="bg-attn-soft text-attn-ink text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                    เริ่ม {formatThaiDate(w.plannedStart)}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
