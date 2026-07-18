// Spec 327 U1 — the procurement dashboard BODY (หน้าหลัก): the project cards
// ARE the selection (D1). Full RLS projects read → zero-open-PR projects render
// zero-count cards (the #621 gap closed); each card is a <form> submit bound to
// setProcurementProject (an httpOnly cookie write REQUIRES a Server Action — a
// Link/render can't set one), landing on /procurement/scope. The alert strip
// (เสี่ยงช้า + ของเข้าวันนี้) reads at PORTFOLIO grain — every visible PR row,
// including null-project store rows, so nothing is silently dropped (§0.1).
// Reads are COUNTS/dates only — no ฿ column is ever selected.

import Link from "next/link";
import { UserPlus } from "lucide-react";

import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { STAFF_APPROVAL_ROLES, type UserRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import {
  ALL_PROJECTS_OPTION_LABEL,
  ARRIVALS_TODAY_LABEL,
  LATE_RISK_LABEL,
} from "@/lib/i18n/labels";
import {
  buildDashboardCards,
  isArrivalToday,
  type DashboardPrRow,
} from "@/lib/purchasing/procurement-home";
import { countLateRisk } from "@/lib/purchasing/late-risk";
import { requestBand } from "@/lib/purchasing/request-bands";
import { resolveSelectedProject } from "@/lib/purchasing/procurement-project";
import { readProcurementProjectCookie } from "@/lib/purchasing/procurement-project.server";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";
import { setProcurementProject } from "./actions";

export async function ProcurementDashboardBody({ role }: { role: UserRole }) {
  const supabase = await createClient();
  const todayIso = bangkokTodayIso();
  const isApprover = STAFF_APPROVAL_ROLES.includes(role);

  // Three RLS reads (procurement's policies admit all projects + WPs): the full
  // project list (cards), PR count rows (both ADR-0065 anchors, no ฿), and the
  // WP planned_start map late-risk resolves anchors against.
  const [{ data: projectRows }, { data: prRows }, { data: wpRows }, cookieValue, pendingCount] =
    await Promise.all([
      supabase.from("projects").select("id, name").order("name"),
      supabase
        .from("purchase_requests")
        .select("project_id, status, eta, work_package_id, requested_from_work_package_id"),
      supabase.from("work_packages").select("id, project_id, planned_start"),
      readProcurementProjectCookie(),
      isApprover
        ? listVisibleTechnicianRegistrations(supabase).then(
            (regs) => regs.filter((r) => r.status === "pending").length,
          )
        : Promise.resolve(0),
    ]);

  const projects = projectRows ?? [];
  const rows: DashboardPrRow[] = (prRows ?? []).map((r) => ({
    projectId: r.project_id,
    status: r.status,
    eta: r.eta,
    workPackageId: r.work_package_id,
    requestedFromWorkPackageId: r.requested_from_work_package_id,
  }));
  const wpById = new Map(
    (wpRows ?? []).map((w) => [w.id, { plannedStart: w.planned_start, projectId: w.project_id }]),
  );

  const cards = buildDashboardCards(projects, rows, wpById, todayIso);
  const selectedProjectId = resolveSelectedProject(
    cookieValue,
    cards.map((c) => c.projectId),
  );

  // Portfolio-grain alert counts — computed over ALL rows directly (a card sum
  // would drop anchorless null-project rows, §0.1).
  const lateRiskTotal = countLateRisk(rows, wpById);
  const arrivalsTotal = rows.filter((r) =>
    isArrivalToday(requestBand(r.status), r.eta, todayIso),
  ).length;

  return (
    <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
      {/* Portfolio alert strip — U3 turns these counts into /procurement/time links. */}
      {lateRiskTotal > 0 || arrivalsTotal > 0 ? (
        <div className="flex flex-wrap gap-2">
          {lateRiskTotal > 0 ? (
            <span className="bg-danger-soft text-danger text-meta rounded-full px-3 py-1 font-bold">
              {LATE_RISK_LABEL} {lateRiskTotal}
            </span>
          ) : null}
          {arrivalsTotal > 0 ? (
            <span className="bg-action text-on-fill text-meta rounded-full px-3 py-1 font-bold">
              {ARRIVALS_TODAY_LABEL} {arrivalsTotal}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* The selection — one card per visible project (zero-count cards render;
          #621). Tapping submits the Server Action → cookie → ขอบเขต. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-body text-ink-secondary font-semibold">โครงการ</h2>
        <div className="flex flex-col gap-2">
          {cards.map((c) => {
            const selected = c.projectId === selectedProjectId;
            return (
              <form key={c.projectId} action={setProcurementProject.bind(null, c.projectId)}>
                <button
                  type="submit"
                  aria-pressed={selected}
                  className={`rounded-card shadow-card border-edge bg-card text-ink hover:bg-sunk flex min-h-11 w-full items-center gap-3 border px-4 py-3 text-left ${
                    selected ? "ring-action ring-2" : ""
                  }`}
                >
                  <span className="text-body min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                  <span className="text-ink-secondary text-meta shrink-0">
                    ขอซื้อ {c.openCount}
                  </span>
                  {c.arrivalsToday > 0 ? (
                    <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                      {ARRIVALS_TODAY_LABEL} {c.arrivalsToday}
                    </span>
                  ) : null}
                  {c.lateRisk > 0 ? (
                    <span className="bg-danger-soft text-danger text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                      {LATE_RISK_LABEL} {c.lateRisk}
                    </span>
                  ) : null}
                </button>
              </form>
            );
          })}
          {cards.length === 0 ? (
            <p className="text-ink-secondary text-body">ยังไม่มีโครงการ</p>
          ) : null}
          {/* The spanning queue — no selection, straight to the full จัดซื้อ list. */}
          <Link
            href="/requests"
            className="rounded-card border-edge bg-card shadow-card hover:bg-sunk text-ink flex min-h-11 items-center gap-3 border px-4 py-3"
          >
            <span className="text-body min-w-0 flex-1 font-medium">
              {ALL_PROJECTS_OPTION_LABEL}
            </span>
            <span className="text-ink-secondary text-meta shrink-0">จัดซื้อทุกโครงการ</span>
          </Link>
        </div>
      </div>

      {/* Re-homed คำขอสมัคร approval nudge (approvers only) — moved from the
          hub's section=null branch; the section pages keep their own arm. */}
      {isApprover ? (
        <Link
          href="/registrations"
          className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex items-center gap-3 border px-4 py-3"
        >
          <UserPlus aria-hidden className="text-action size-5 shrink-0" />
          <span className="text-body text-ink min-w-0 flex-1 font-medium">คำขอสมัคร</span>
          {pendingCount > 0 ? (
            <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
              {pendingCount}
            </span>
          ) : null}
        </Link>
      ) : null}
    </section>
  );
}
