// Spec 388 U2 (D3) — ประวัติ is the ช่าง's ATTENDANCE record, not their money.
//
// Spec 376 U3 made this route the money half (รายการรอรับ, wage history, bank).
// Two days of telemetry then said the tab had NEVER been opened — 0 route views
// all-time — and an audit found two of its three sections empty by construction:
// wage_payments is 0 rows all-time (the spec-306 money wall holds every worker
// until cost-confirm) and pending bank requests are 0. Its only live content,
// รายการรอรับ, is the ONLY write a ช่าง owns, and it was parked behind a
// money-labelled tab nobody taps — so it moves UP to หน้าหลัก, and the bank and
// wage list go back there with it (spec 388 D4/D5).
//
// What lands here instead is the one subject with real rows: 189 muster scans
// across 29 workers in 30 days, and no surface has ever shown a ช่าง their own.
//
// ⚠️ The read is get_my_attendance() (spec 388 U1), a self-scoped SECURITY
// DEFINER RPC, because muster_attendance's ONLY select policy keys on
// can_see_project — which falls to `else false` for technician. A plain table
// read here returns zero rows, always.
//
// Still a TAB destination, so NO back chip: the bar (phone) and the HubNav strip
// (desktop) are how a ช่าง moves between หน้าหลัก and ประวัติ. U3 removes the tab
// and adds the chip in the SAME unit — doing it here would leave a tab whose
// destination carries a back chip, the exact defect U3 exists to remove.
//
// No 'use client' — a plain Server Component; the list is pure render.

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { WorkerAttendanceMonth } from "@/components/features/portal/worker-attendance-month";
import { buildAttendanceMonthView } from "@/lib/attendance/attendance-sessions";
import { resolveMonthAnchor } from "@/lib/attendance/attendance-month";
import { addMonthsIso } from "@/lib/work-packages/calendar-grid";
import { bangkokTodayIso } from "@/lib/dates";
import { ATTENDANCE_OWN_LABEL } from "@/lib/i18n/labels";
import { ViewAsEmptyNote } from "@/components/features/chrome/view-as-empty-note";

export const metadata = { title: ATTENDANCE_OWN_LABEL };

export default async function TechnicianHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const { role } = await requireRole(["technician"]);
  const supabase = await createClient();

  // ?m=YYYY-MM → a safe YYYY-MM-01 anchor, reusing spec 374's resolver rather
  // than re-deriving it: an unclamped year reaches the grid as an expanded-year
  // ISO string and renders a mislabeled century.
  const { m } = await searchParams;
  const monthAnchor = resolveMonthAnchor(m, bangkokTodayIso());

  const { data: attendanceRows } = await supabase.rpc("get_my_attendance");
  const view = buildAttendanceMonthView({ rows: attendanceRows ?? [], monthAnchor });
  const monthHref = (anchor: string) => `/technician/history?m=${anchor.slice(0, 7)}`;

  return (
    <PageShell>
      <BottomTabBar role={role} />
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink min-w-0 truncate font-bold tracking-tight">
            {ATTENDANCE_OWN_LABEL}
          </h1>
          <LogoutButton />
        </div>
      </header>
      <HubNav
        maxWidthClass={PAGE_MAX_W}
        items={hubNavForRole(role) ?? []}
        currentHref="/technician/history"
        role={role}
      />

      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 pt-6 pb-28`}>
        {/* Spec 274 U2 — without it a super_admin viewing-as-technician reads
            this page's empty state as "this ช่าง has no record" rather than "you
            are not a ช่าง". The read self-scopes to the CALLER's worker row, so
            an assumed role legitimately has none. Renders null in normal use. */}
        <ViewAsEmptyNote />
        <WorkerAttendanceMonth
          view={view}
          prevHref={monthHref(addMonthsIso(monthAnchor, -1))}
          nextHref={monthHref(addMonthsIso(monthAnchor, 1))}
        />
      </section>
    </PageShell>
  );
}
