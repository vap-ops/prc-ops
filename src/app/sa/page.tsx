// Spec 192 U4 — the site-admin daily home. The SA used to land on the project hub
// (/projects), so the daily loop (log labor / photos / PR) was buried 3–4 taps deep
// in a WP tab. This lands them straight on "งานของฉัน": their visible, not-done work
// packages (WP-centric — the WP is the unit of daily work), each one tap to its
// detail and a tap to the labor / photo / PR tab via the WP-detail hash deep-links.
// The full project hub stays a bottom tab. (Standalone hero/quick actions need a
// global "pick a งาน" step — a later unit.)

import Link from "next/link";
import { CalendarPlus, Camera, HardHat, ShoppingCart } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { EmptyNotice } from "@/components/features/common/notices";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { workPackageHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import {
  DAILY_WORK_PLAN_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { bangkokTodayIso } from "@/lib/dates";
import { buildSaActionList, type BouncedWp, type ReworkInfo } from "@/lib/sa/action-list";
import { getLatestDecisionsForWorkPackages } from "@/lib/approvals/latest-decision";
import { SaActionSection } from "@/components/features/sa/action-section";
import { DailyHero } from "@/components/features/sa/daily-hero";
import type { ReworkSource } from "@/lib/db/enums";

export const metadata = { title: "หน้าหลัก" };

export default async function SaHomePage() {
  const ctx = await requireRole(["site_admin", "super_admin"]);
  const supabase = await createClient();

  // RLS scopes work_packages to the SA's member projects (can_see_wp / ADR 0056),
  // so this is already "my" work. Spec 218: keep pending_approval (drop only
  // complete) — a WP the PM bounced (ให้แก้ไข / ไม่อนุมัติ) stays pending_approval
  // but is back on the SA's plate; we surface it from its latest decision.
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id, rework_round")
    // Spec 270 U5: งาน grouping rows are never actionable — leaves only.
    .eq("is_group", false)
    .neq("status", "complete");
  const wps = wpRows ?? [];

  const projectIds = Array.from(new Set(wps.map((w) => w.project_id)));
  const { data: projects } = projectIds.length
    ? await supabase.from("projects").select("id, code, name").in("id", projectIds)
    : { data: [] };
  const projectsById = new Map((projects ?? []).map((p) => [p.id, { code: p.code, name: p.name }]));

  // pending_approval WPs whose LATEST decision is negative = the PM bounced them
  // back to the SA (spec 218). One read per the latest-decision pattern.
  const pendingWps = wps.filter((w) => w.status === "pending_approval");
  const latestDecisions = pendingWps.length
    ? await getLatestDecisionsForWorkPackages(
        supabase,
        pendingWps.map((w) => w.id),
      )
    : new Map();
  const bounced: BouncedWp[] = pendingWps.flatMap((w) => {
    const dec = latestDecisions.get(w.id);
    if (dec?.decision === "needs_revision" || dec?.decision === "rejected") {
      return [{ wp: w, decision: dec.decision, comment: dec.comment }];
    }
    return [];
  });

  // rework WPs: the latest reopen audit row carries the current reason + source
  // (spec 216/217); the round is on the WP itself.
  const reworkWps = wps.filter((w) => w.status === "rework");
  const reworkInfo = new Map<string, ReworkInfo>();
  if (reworkWps.length) {
    const { data: reopenRows } = await supabase
      .from("audit_log")
      .select("target_id, payload")
      .in(
        "target_id",
        reworkWps.map((w) => w.id),
      )
      .eq("payload->>event", "wp_reopened_for_defect")
      .order("created_at", { ascending: false });
    for (const w of reworkWps) {
      const p = (reopenRows ?? []).find((r) => r.target_id === w.id)?.payload as {
        reason?: string;
        source?: ReworkSource;
      } | null;
      reworkInfo.set(w.id, {
        reason: p?.reason ?? null,
        source: p?.source === "client" || p?.source === "internal" ? p.source : null,
        round: w.rework_round,
      });
    }
  }

  const inPlay = wps.filter((w) => w.status !== "pending_approval");
  const { actions, rest } = buildSaActionList({ inPlay, bounced, reworkInfo, projectsById });
  const items = rest;
  const hubItems = hubNavForRole(ctx.role);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {hubItems ? (
        <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/sa" role={ctx.role} />
      ) : null}
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        <div>
          <p className="text-ink-secondary text-meta">{formatThaiDate(bangkokTodayIso())}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            สวัสดี{ctx.fullName ? ` ${ctx.fullName}` : ""}
          </h1>
        </div>

        {/* Spec 273 U2 — entry to the next-day work board (แผนพรุ่งนี้). */}
        <Link href="/sa/plan" className={`${BUTTON_SECONDARY} w-full gap-2`}>
          <CalendarPlus aria-hidden className="size-4 shrink-0" />
          {DAILY_WORK_PLAN_LABEL}
        </Link>

        {/* Spec 218: WPs the PM/defect bounced back — pinned above everything,
            color-coded (amber = fix, red = rejected), one tap to the capture. */}
        <SaActionSection items={actions} />

        {/* Spec 192 U4b: the daily-action hero — one tap to log labour / add a
            photo (direct when there's a single active WP, else a เลือกงาน
            picker). Renders nothing when there's no active work. */}
        <DailyHero
          wps={items.map((it) => ({
            id: it.id,
            projectId: it.projectId,
            code: it.code,
            name: it.name,
          }))}
        />

        <div className="flex flex-col gap-3">
          <h2 className="text-meta text-ink-secondary font-semibold">งานของฉัน</h2>
          {items.length === 0 ? (
            <EmptyNotice>
              ยังไม่มีงานที่ต้องดูแล — เริ่มจาก{" "}
              <Link
                href="/projects"
                className="text-action font-medium underline-offset-2 hover:underline"
              >
                โครงการ
              </Link>
            </EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((it) => (
                <li key={it.id} className="rounded-card border-edge bg-card shadow-card border p-4">
                  <Link
                    href={withBackFrom(workPackageHref(it.projectId, it.id), "/sa")}
                    className="focus-visible:ring-action rounded-control block focus:outline-none focus-visible:ring-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink text-body font-semibold break-words">{it.name}</p>
                        <p className="text-ink-muted text-meta">
                          <span className="font-mono">{it.code}</span>
                          {it.projectCode ? ` · ${it.projectCode} ${it.projectName}` : ""}
                        </p>
                      </div>
                      <span
                        className={`text-meta shrink-0 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap ${workPackageStatusPillClasses(it.status)}`}
                      >
                        {WORK_PACKAGE_STATUS_LABEL[it.status]}
                      </span>
                    </div>
                  </Link>

                  <div className="mt-3 flex gap-2">
                    <ActionChip
                      href={withBackFrom(
                        `${workPackageHref(it.projectId, it.id)}#wp-photos`,
                        "/sa",
                      )}
                      icon={Camera}
                      label="รูปถ่าย"
                    />
                    <ActionChip
                      href={withBackFrom(`${workPackageHref(it.projectId, it.id)}#wp-labor`, "/sa")}
                      icon={HardHat}
                      label="ทีมงาน"
                    />
                    <ActionChip
                      href={withBackFrom(
                        `${workPackageHref(it.projectId, it.id)}#wp-requests`,
                        "/sa",
                      )}
                      icon={ShoppingCart}
                      label="คำขอซื้อ"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </PageShell>
  );
}

function ActionChip({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Camera;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="border-edge bg-page text-ink-secondary hover:bg-sunk focus-visible:ring-action rounded-control text-meta flex h-11 flex-1 items-center justify-center gap-1.5 border font-medium transition-colors focus:outline-none focus-visible:ring-2"
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </Link>
  );
}
