// Spec 142 U3 — the onboarding checklist on the project page. Presentational:
// the page reads project_onboarding_status (booleans, money-safe) and passes
// them here. Each unmet item is a deep link to where it's filled in; met items
// show a done marker. The whole card hides once dismissed or fully complete —
// derived state, so it can't drift from the data (WP-centric: the project is
// usable immediately; this just guides enrichment).

import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { projectHref, projectSettingsHref } from "@/lib/nav/project-paths";
import { SECTION_HEADING } from "@/lib/ui/classes";
import { DismissOnboardingButton } from "./dismiss-onboarding-button";

export interface OnboardingStatus {
  dates_lead_set: boolean;
  budget_set: boolean;
  team_added: boolean;
  work_packages_added: boolean;
  client_set: boolean;
  dismissed: boolean;
}

export function OnboardingChecklist({
  projectId,
  status,
  deliverablesDone,
}: {
  projectId: string;
  status: OnboardingStatus;
  // Spec 164 U4 — derived in the page (≥1 งวด AND no ungrouped งาน), not part of
  // the project_onboarding_status RPC. Nudges งวด setup after WPs exist.
  deliverablesDone: boolean;
}) {
  const rows: { key: string; label: string; hint?: string; done: boolean; href: string }[] = [
    {
      // Spec 192 U2: team leads — it's the access prerequisite. A project is only
      // visible to its members (can_see_project, ADR 0056), so adding the team
      // first is what lets the site admin see and work on it at all.
      key: "team",
      label: "เพิ่มทีมงาน",
      hint: "เพิ่มก่อนเป็นอันดับแรก เพื่อให้พวกเขาเห็นโครงการและเริ่มทำงานได้",
      done: status.team_added,
      href: projectSettingsHref(projectId),
    },
    {
      key: "dates_lead",
      label: "กำหนดวันและผู้รับผิดชอบ",
      done: status.dates_lead_set,
      href: projectSettingsHref(projectId),
    },
    {
      key: "budget",
      label: "ระบุงบประมาณ",
      done: status.budget_set,
      href: projectSettingsHref(projectId),
    },
    {
      key: "work_packages",
      label: "เพิ่มรายการงาน",
      done: status.work_packages_added,
      href: `${projectHref(projectId)}#work-packages`,
    },
    {
      key: "deliverables",
      label: "สร้างงวดงานและจัดกลุ่มงาน",
      done: deliverablesDone,
      // Feedback f625f04d: the งวดงาน manager lives on the settings page now.
      href: `${projectSettingsHref(projectId)}#deliverables`,
    },
    {
      key: "client",
      label: "เลือกลูกค้า",
      done: status.client_set,
      href: projectSettingsHref(projectId),
    },
  ];

  // Hide once dismissed or every item is met — derived, never stored.
  if (status.dismissed || rows.every((r) => r.done)) return null;
  const doneCount = rows.filter((r) => r.done).length;

  return (
    <section
      aria-label="เริ่มต้นโครงการ"
      className="rounded-card border-edge bg-card shadow-card mb-6 flex flex-col gap-3 border p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={SECTION_HEADING}>
          <span>เริ่มต้นโครงการ</span>{" "}
          <span className="text-ink-muted text-sm font-normal">
            {doneCount}/{rows.length}
          </span>
        </h2>
        <DismissOnboardingButton projectId={projectId} />
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((r) =>
          r.done ? (
            <li key={r.key} className="text-ink-muted flex items-center gap-2 px-3 py-2 text-sm">
              <span
                aria-label="เสร็จแล้ว"
                className="text-done inline-flex size-5 shrink-0 items-center justify-center"
              >
                <Check aria-hidden className="size-4" />
              </span>
              <span className="line-through">{r.label}</span>
            </li>
          ) : (
            <li key={r.key}>
              <Link
                href={r.href}
                className="rounded-control border-edge bg-page hover:bg-sunk focus-visible:ring-action flex min-h-11 items-center justify-between gap-3 border px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2"
              >
                <span className="min-w-0">
                  <span className="text-ink block text-sm font-medium">{r.label}</span>
                  {r.hint ? <span className="text-ink-muted block text-xs">{r.hint}</span> : null}
                </span>
                <ChevronRight aria-hidden className="text-ink-muted size-4 shrink-0" />
              </Link>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
