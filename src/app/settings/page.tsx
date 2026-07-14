import type { ReactNode } from "react";
import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ChevronRight } from "lucide-react";
import { AvatarSurface } from "@/components/features/common/avatar-surface";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { ThemeToggle } from "@/components/features/chrome/theme-toggle";
import { ApprovalsBadge } from "@/components/features/dashboard/pending-approvals-badge";
import { DailyReportPreviewButton } from "@/components/features/daily-report/daily-report-preview-button";
import { THEME_COOKIE, parseThemeSetting } from "@/lib/ui/theme";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { createClient } from "@/lib/db/server";
import { getOpenFeedbackCount } from "@/lib/feedback/triage-count";
import { SETTINGS_SECTIONS } from "./sections";
import { GROUP_CARD, ROW, SettingsSectionCard } from "./section-card";
// Server-only import (this page is a Server Component) — no client bundle bloat,
// no version drift vs package.json.
import pkg from "../../../package.json";

// ตั้งค่า (Settings) hub — the back-office + account home. Declutters the bottom
// bar: the daily-decision surfaces stay as tabs; reference data (contacts,
// workers), finance (payroll), and the account (profile + logout) live here.
// Reachable by every authenticated role (like /profile — getClaims, not
// requireRole, so unserved roles aren't bounced).
//
// Regroup (2026-07-03): each section renders as ONE grouped card (rows share a
// bordered container with hairline dividers — the settings/usage idiom) instead
// of a floating card per row; the section/entry list + role gating live in
// ./sections.ts (the config SSOT), rendered by ./section-card.tsx. Only the
// rows needing page-scope data (profile, theme, daily-report test, version)
// stay hand-written below.

export const metadata = { title: "ตั้งค่า" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) redirect("/login");
  const userId = claimsData.claims.sub;

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name, line_avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (!row) {
    console.error("[/settings] users row missing", { userId });
    redirect("/login");
  }

  const role = row.role;
  // Spec 201 A2 — the caller's unread team replies, badged on the feedback entry so a
  // reply is visible from settings without drilling into the thread. Best-effort (no
  // badge on failure); feedback_unread_ids is definer + caller-scoped.
  const { data: unreadFeedbackIds } = await supabase.rpc("feedback_unread_ids");
  const unreadFeedback = unreadFeedbackIds?.length ?? 0;
  // Spec 201 / feedback 152d2e34: the open-feedback triage count lives HERE (the
  // app-admin surface), not on the ภาพรวม dashboard. super_admin only (they alone
  // triage; RLS reads all open reports).
  const openFeedback = role === "super_admin" ? await getOpenFeedbackCount(supabase) : 0;
  // Awareness pills injected into the config-driven rows by href.
  const badges: Record<string, ReactNode> = {
    "/feedback": <ApprovalsBadge count={unreadFeedback} position="inline" label="ตอบกลับใหม่" />,
    "/feedback/review": <ApprovalsBadge count={openFeedback} position="inline" label="รอตรวจ" />,
  };
  // Spec 190: current theme setting (cookie) — drives the toggle's initial state
  // with no flash / no hydration mismatch.
  const themeSetting = parseThemeSetting((await cookies()).get(THEME_COOKIE)?.value);
  // Spec 153: the desktop hub strip, like the sibling hubs (/projects, /review).
  // Phones leave via the bottom tab bar; unserved roles (hubItems null) get none.
  const hubItems = hubNavForRole(role);

  const configSection = (key: string) => {
    const section = SETTINGS_SECTIONS.find((s) => s.key === key);
    return section ? <SettingsSectionCard section={section} role={role} badges={badges} /> : null;
  };

  return (
    <PageShell>
      <BottomTabBar role={role} />
      {hubItems ? (
        <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/settings" role={role} />
      ) : null}
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        <h1 className="text-title text-ink font-bold tracking-tight">ตั้งค่า</h1>

        {/* Account — everyone */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">บัญชี</h2>
          <div className={`${GROUP_CARD} border`}>
            <Link href="/profile" className={ROW} aria-label="โปรไฟล์">
              <AvatarSurface lineUrl={row.line_avatar_url} fullName={row.full_name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="text-ink text-body block font-semibold">
                  {row.full_name ?? "โปรไฟล์"}
                </span>
                <span className="text-ink-secondary text-meta block">
                  แก้ไขชื่อที่แสดง · รูปโปรไฟล์
                </span>
              </span>
              <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
            </Link>
            {/* Spec 193 feedback: logout removed here — it's redundant with the
                /profile screen (one tap via the row above) and the browser
                app-header. "logout lives on /profile." */}
          </div>
        </div>

        {configSection("field")}
        {configSection("master-data")}
        {configSection("labor-team")}
        {configSection("finance")}
        {configSection("office-expenses")}

        {/* Appearance — everyone (spec 190). Light by default (sun-first); dark
            is opt-in. ระบบ follows the device. ThemeToggle is already its own
            bordered card — no GroupCard wrapper. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">การแสดงผล</h2>
          <ThemeToggle initial={themeSetting} />
        </div>

        {configSection("help")}
        {configSection("coming-soon")}

        {/* Spec 212: daily-report Flex preview — operator only. Sends a sample
            report to the caller's OWN LINE (no guessed recipient) to validate the
            bubble layout before the feature is wired for the team. */}
        {role === "super_admin" && (
          <div className="flex flex-col gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">รายงานประจำวัน (ทดสอบ)</h2>
            <div className={`${GROUP_CARD} border`}>
              <div className="flex flex-col gap-2 px-4 py-3">
                <p className="text-ink-secondary text-meta">
                  ส่งรายงานตัวอย่างเข้า LINE ของคุณ เพื่อดูรูปแบบจริงก่อนเปิดใช้งานจริง
                </p>
                <DailyReportPreviewButton />
              </div>
            </div>
          </div>
        )}

        {configSection("admin")}

        {/* About — everyone */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">เกี่ยวกับ</h2>
          <div className={`${GROUP_CARD} border`}>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-ink text-body font-semibold">PRC Ops</span>
              <span className="text-ink-secondary text-meta font-mono">เวอร์ชัน {pkg.version}</span>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
