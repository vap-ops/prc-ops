// Spec 327 U3 — the เวลา view host: resolve the U1 selection, load the
// project's time data, and render the ?view= sub-view behind a pill switcher
// (เสี่ยงช้า | สัปดาห์นี้ — U4 slots ไทม์ไลน์ in as the third pill). Renders
// ABOVE the time door grid until U6. No selection → the shared picker prompt.

import Link from "next/link";

import { TimeLateRiskList } from "@/components/features/purchasing/time-late-risk-list";
import { TimeWeekRadar } from "@/components/features/purchasing/time-week-radar";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { LATE_RISK_LABEL, THIS_WEEK_LABEL } from "@/lib/i18n/labels";
import {
  buildLateRiskList,
  buildWeekRadar,
  type TimePrRow,
  type TimeView as TimeSubView,
} from "@/lib/purchasing/time-view";
import { loadTimeViewData, type TimeViewWp } from "@/lib/purchasing/load-time-view";
import { resolveSelectedProject } from "@/lib/purchasing/procurement-project";
import { readProcurementProjectCookie } from "@/lib/purchasing/procurement-project.server";
import { weekOf } from "@/lib/work-packages/calendar-grid";
import { ProjectPickerPrompt } from "./project-picker-prompt";

const PILLS: ReadonlyArray<{ key: TimeSubView; label: string }> = [
  { key: "late", label: LATE_RISK_LABEL },
  { key: "week", label: THIS_WEEK_LABEL },
];

function WeekArm({
  projectId,
  wps,
  prRows,
}: {
  projectId: string;
  wps: ReadonlyArray<TimeViewWp>;
  prRows: ReadonlyArray<TimePrRow>;
}) {
  const week = weekOf(bangkokTodayIso());
  const radar = buildWeekRadar(wps, prRows, week);
  return (
    <TimeWeekRadar
      projectId={projectId}
      week={week}
      arrivals={radar.arrivals}
      weekWps={radar.weekWps}
    />
  );
}

export async function TimeView({ view }: { view: TimeSubView }) {
  const supabase = await createClient();
  const { data: projectRows } = await supabase.from("projects").select("id, name").order("name");
  const projects = projectRows ?? [];
  const selected = resolveSelectedProject(
    await readProcurementProjectCookie(),
    projects.map((p) => p.id),
  );
  if (!selected)
    return <ProjectPickerPrompt heading="เลือกโครงการเพื่อดูเวลา" projects={projects} />;
  const selectedName = projects.find((p) => p.id === selected)?.name ?? "";

  const { wps, prRows } = await loadTimeViewData(supabase, selected);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-body text-ink min-w-0 flex-1 truncate font-semibold">{selectedName}</h2>
        <Link href="/procurement" className="text-action text-meta shrink-0 underline">
          เปลี่ยนโครงการ
        </Link>
      </div>

      {/* Sub-view pills — ?view= (query, not a route: the bottom-tab active
          rule is query-blind, a sub-route would double-light tabs). */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="มุมมองเวลา">
        {PILLS.map((p) => (
          <Link
            key={p.key}
            href={`/procurement/time?view=${p.key}`}
            aria-current={view === p.key ? "true" : undefined}
            className={`text-meta inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
              view === p.key
                ? "bg-fill text-on-fill border-fill"
                : "border-edge bg-card text-ink-secondary hover:bg-sunk"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {view === "week" ? (
        <WeekArm projectId={selected} wps={wps} prRows={prRows} />
      ) : (
        <TimeLateRiskList items={buildLateRiskList(prRows, wps)} />
      )}
    </div>
  );
}
