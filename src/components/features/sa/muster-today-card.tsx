// Spec 334 U1 — the วันนี้ hero. Replaces the flat เช็คชื่อ link at the top of
// /team with a card that leads on today's attendance: project + Bangkok date, the
// headline count, and one action. Presentational — pure props, no data fetch (the
// page runs loadMusterDaySummary and hands the shape down). The cockpit stays the
// single write path; every state's CTA links to musterHref(projectId).
//
// ปิดวันแล้ว is the one 2-surface string (also muster-cockpit.tsx) → imported from
// labels. The rest render only here, so they stay local per the UI-term SSOT rule.

import Link from "next/link";
import { ScanLine, ArrowRight } from "lucide-react";
import { MUSTER_DAY_CLOSED_LABEL } from "@/lib/i18n/labels";
import { withBackFrom } from "@/lib/nav/back-href";
import { musterHref } from "@/lib/nav/project-paths";
import type { MusterDaySummary } from "@/lib/muster/day-summary";

const CTA_START = "เริ่มเช็คชื่อ";
const CTA_GO = "ไปหน้าเช็คชื่อ";
const CTA_DETAIL = "ดูรายละเอียด";
const NO_CHECKIN_YET = "ยังไม่มีใครเช็คชื่อวันนี้";
const NO_WORKERS = "ยังไม่มีช่างในโครงการนี้";
const NO_ATTENDANCE = "ไม่มีคนมาทำงาน";
const ATTEND_LABEL = "มาทำงาน";

function Headline({ summary }: { summary: MusterDaySummary }) {
  // Closed leads with the SSOT'd banner + the truthful attendance tally (or its
  // zero form); it never shows a denominator, so the expected-0 guard is moot here.
  if (summary.state === "closed") {
    const body =
      summary.present === 0
        ? `${MUSTER_DAY_CLOSED_LABEL} · ${NO_ATTENDANCE}`
        : `${MUSTER_DAY_CLOSED_LABEL} · ${ATTEND_LABEL} ${summary.present} คน`;
    return <p className="text-ink text-lg font-bold">{body}</p>;
  }
  // No active workers on the project → the count would read "0 / 0"; show the
  // no-technicians line in its place (spec U1 negative case). CTA still renders.
  if (summary.expected === 0) {
    return <p className="text-ink text-body font-semibold">{NO_WORKERS}</p>;
  }
  // present may legitimately exceed expected (cross-project scan) — render truth,
  // never clamp (spec Model). The explicit space keeps "N / M มาทำงาน" contiguous.
  return (
    <p className="text-ink text-2xl font-bold">
      {summary.present} / {summary.expected}{" "}
      <span className="text-ink-secondary text-body font-normal">{ATTEND_LABEL}</span>
    </p>
  );
}

export function MusterTodayCard({
  summary,
  projectId,
  projectName,
  dateLabel,
}: {
  summary: MusterDaySummary;
  projectId: string;
  projectName: string;
  dateLabel: string;
}) {
  const primary = summary.state !== "closed";
  const ctaLabel =
    summary.state === "not_started" ? CTA_START : summary.state === "open" ? CTA_GO : CTA_DETAIL;

  return (
    <section className="border-edge bg-card shadow-card rounded-card flex flex-col gap-3 border p-4">
      <p className="text-ink-secondary text-meta min-w-0 truncate">
        {projectName} · {dateLabel}
      </p>

      <Headline summary={summary} />

      {/* Review fix: with zero workers the no-technicians headline already says it
          all — the "no one checked in yet" sub-line would be redundant noise. */}
      {summary.state === "not_started" && summary.expected > 0 ? (
        <p className="text-ink-secondary text-meta">{NO_CHECKIN_YET}</p>
      ) : null}

      <Link
        // Spec 334 follow-up: thread ?from=/team so the cockpit's back chip
        // returns to this hub, not the project page (multi-parent class).
        href={withBackFrom(musterHref(projectId), "/team")}
        className={
          primary
            ? "bg-fill text-on-fill flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold"
            : "border-edge bg-card text-ink flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold"
        }
      >
        {primary ? (
          <ScanLine aria-hidden className="size-4 shrink-0" />
        ) : (
          <ArrowRight aria-hidden className="size-4 shrink-0" />
        )}
        {ctaLabel}
      </Link>
    </section>
  );
}
