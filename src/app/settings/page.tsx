import type { ReactNode } from "react";
import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  Calculator,
  ChevronRight,
  Contact,
  Files,
  Hammer,
  HardHat,
  Inbox,
  Package,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Wallet,
  Wrench,
  MessageSquarePlus,
  Activity,
} from "lucide-react";
import { AvatarSurface } from "@/components/features/common/avatar-surface";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { ComingSoonBadge } from "@/components/features/chrome/coming-soon-badge";
import { ThemeToggle } from "@/components/features/chrome/theme-toggle";
import { ApprovalsBadge } from "@/components/features/dashboard/pending-approvals-badge";
import { DailyReportPreviewButton } from "@/components/features/daily-report/daily-report-preview-button";
import { THEME_COOKIE, parseThemeSetting } from "@/lib/ui/theme";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { createClient } from "@/lib/db/server";
import { ACCOUNTING_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { getOpenFeedbackCount } from "@/lib/feedback/triage-count";
import { CATALOG_LABEL, SUBCONTRACTOR_LABEL } from "@/lib/i18n/labels";
// Server-only import (this page is a Server Component) — no client bundle bloat,
// no version drift vs package.json.
import pkg from "../../../package.json";

// ตั้งค่า (Settings) hub — the back-office + account home. Declutters the bottom
// bar: the daily-decision surfaces stay as tabs; reference data (contacts,
// workers), finance (payroll), and the account (profile + logout) live here.
// Reachable by every authenticated role (like /profile — getClaims, not
// requireRole, so unserved roles aren't bounced). Master-data + finance sections
// are PM/super only. ("Nova" — the gamification/growth hub — will slot under บัญชี.)

export const metadata = { title: "ตั้งค่า" };

const ROW =
  "border-edge bg-card hover:bg-sunk focus-visible:ring-action flex items-center gap-3 rounded-control border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2";

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
  const isManager = isManagerRole(role);
  // Spec 201 A2 — the caller's unread team replies, badged on the feedback entry so a
  // reply is visible from settings without drilling into the thread. Best-effort (no
  // badge on failure); feedback_unread_ids is definer + caller-scoped.
  const { data: unreadFeedbackIds } = await supabase.rpc("feedback_unread_ids");
  const unreadFeedback = unreadFeedbackIds?.length ?? 0;
  // Spec 201 / feedback 152d2e34: the open-feedback triage count lives HERE (the
  // app-admin surface), not on the ภาพรวม dashboard. super_admin only (they alone
  // triage; RLS reads all open reports).
  const openFeedback = role === "super_admin" ? await getOpenFeedbackCount(supabase) : 0;
  // Spec 190: current theme setting (cookie) — drives the toggle's initial state
  // with no flash / no hydration mismatch.
  const themeSetting = parseThemeSetting((await cookies()).get(THEME_COOKIE)?.value);
  // Spec 153: the desktop hub strip, like the sibling hubs (/projects, /review).
  // Phones leave via the bottom tab bar; unserved roles (hubItems null) get none.
  const hubItems = hubNavForRole(role);

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

        {/* Field tools — site_admin (spec 141 U5). The field can view + move
            equipment but not curate the registry; managers reach อุปกรณ์ from
            the master-data section below with the registry framing. */}
        {role === "site_admin" && (
          <div className="flex flex-col gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">หน้างาน</h2>
            <SettingsLink
              href="/equipment"
              icon={Wrench}
              label="อุปกรณ์"
              hint="ดูและย้ายอุปกรณ์หน้างาน"
            />
            {/* Spec 197 U2: the stock-count surface left settings — ตรวจนับ is
                now reached through a project's คลัง chip (per-row spot count +
                ตรวจนับทั้งคลัง full stocktake). */}
          </div>
        )}

        {/* Spec 172 Phase B + C: procurement curates subcontractors and onboards
            DC workers (its other back-office contacts — suppliers — sit in its hub
            strip). Mobile reaches these via the ตั้งค่า tab. */}
        {role === "procurement" && (
          <>
            <div className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">ข้อมูลหลัก</h2>
              {/* Spec 187: procurement settings mirror the project-director master-data
                list. ผู้ขาย (vendors) is already in procurement's desktop hub strip
                (BACK_OFFICE_ROLES); this surfaces it in the phone settings list too. */}
              <SettingsLink
                href="/contacts/vendors"
                icon={Store}
                label="ผู้ขาย/ผู้ให้บริการ"
                hint="ผู้ขายวัสดุ · ผู้ให้บริการ"
              />
              <SettingsLink
                href="/contacts/subcontractors"
                icon={Hammer}
                label={SUBCONTRACTOR_LABEL}
                hint="บริษัทที่จ้างช่วง (จ่ายลูกทีมเอง)"
              />
              {/* Spec 172 Phase C: procurement onboards DC workers (incl. the pay rate). */}
              <SettingsLink href="/workers" icon={HardHat} label="ทีมงาน" hint="ทะเบียนทีมงาน DC" />
              {/* Spec 187: procurement already reaches /equipment (EQUIPMENT_MOVE_ROLES,
                spec 172 Phase A) — surface the registry door in settings. */}
              <SettingsLink
                href="/equipment"
                icon={Wrench}
                label="อุปกรณ์"
                hint="ทะเบียนอุปกรณ์เช่า"
              />
              {/* Spec 175: procurement curates the item catalog (the store's item master). */}
              <SettingsLink
                href="/catalog"
                icon={Package}
                label={CATALOG_LABEL}
                hint="รายการวัสดุมาตรฐานสำหรับจัดซื้อ"
              />
              {/* Spec 197 U1: the store (คลัง) left settings for the per-project
                  sub-route — reached from each project's header chip, not here. */}
            </div>

            {/* Spec 187: การเงิน parity — procurement views + pays DC payroll
              (PAYROLL_ROLES; record_dc_payment admits it). บัญชี (GL) + Nova stay
              out — ACCOUNTING_ROLES / super-only, director doesn't get them either. */}
            <div className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">การเงิน</h2>
              <SettingsLink
                href="/payroll"
                icon={Wallet}
                label="ค่าจ้าง"
                hint="สรุปค่าจ้าง DC + ส่งออก CSV"
              />
            </div>
          </>
        )}

        {isManager && (
          <>
            {/* Master data — PM/super */}
            <div className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">ข้อมูลหลัก</h2>
              {/* Spec 99: ติดต่อ split into three group screens. */}
              <SettingsLink
                href="/contacts/customers"
                icon={Users}
                label="ลูกค้า"
                hint="เจ้าของโครงการ"
              />
              <SettingsLink
                href="/contacts/vendors"
                icon={Store}
                label="ผู้ขาย/ผู้ให้บริการ"
                hint="ผู้ขายวัสดุ · ผู้ให้บริการ"
              />
              {/* Spec 168: ผู้รับเหมาช่วง is its own door. ADR 0062 U5: DC is a
                  WORKER (no DC firm) — the old /contacts/dc party door is gone; DC
                  lives only under ทีมงาน below. */}
              <SettingsLink
                href="/contacts/subcontractors"
                icon={Hammer}
                label={SUBCONTRACTOR_LABEL}
                hint="บริษัทที่จ้างช่วง (จ่ายลูกทีมเอง)"
              />
              <SettingsLink
                href="/workers"
                icon={HardHat}
                label="ทีมงาน"
                hint="ทะเบียน DC (ประจำ/ชั่วคราว) · ค่าจ้าง"
              />
              <SettingsLink
                href="/equipment"
                icon={Wrench}
                label="อุปกรณ์"
                hint="ทะเบียนอุปกรณ์เช่า"
              />
              {/* Spec 175: the item catalog (the store's item master). */}
              <SettingsLink
                href="/catalog"
                icon={Package}
                label={CATALOG_LABEL}
                hint="รายการวัสดุมาตรฐาน"
              />
              {/* Spec 197 U1: the store (คลัง) left settings for the per-project
                  sub-route — reached from each project's header chip, not here. */}
            </div>

            {/* Finance — PM/super */}
            <div className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">การเงิน</h2>
              <SettingsLink
                href="/payroll"
                icon={Wallet}
                label="ค่าจ้าง"
                hint="สรุปค่าจ้าง DC + ส่งออก CSV"
              />
              {/* Spec 166: บัญชี (GL) hidden from PM/director during beta — its
                  numbers are provisional until the accountant config lands. Only
                  ACCOUNTING_ROLES (accounting + super_admin) see it; ค่าจ้าง stays. */}
              {(ACCOUNTING_ROLES as readonly string[]).includes(role) && (
                <SettingsLink
                  href="/accounting"
                  icon={Calculator}
                  label="บัญชี"
                  hint="งบทดลอง · กำไร–ขาดทุน · กระทบยอด"
                />
              )}
              {/* Spec 162: Nova's home is บัญชี. Operator-only for v1 (coins are
                  super_admin-read + externals-invisible). */}
              {role === "super_admin" && (
                <SettingsLink
                  href="/nova"
                  icon={Sparkles}
                  label="Nova"
                  hint="เหรียญรางวัลทีมงาน · มอบเหรียญ"
                />
              )}
            </div>
          </>
        )}

        {/* Coming soon — everyone (spec 98). Greyed previews of planned menus
            so the full set is visible. "Nova" is the gamification/growth hub
            (brand name, operator-chosen 2026-06-15; eventual home is บัญชี,
            build HELD); คลังเอกสาร is a future central document library. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">เร็วๆนี้</h2>
          {/* Spec 162: super_admin gets the live Nova link above; everyone else
              still sees the coming-soon preview. */}
          {role !== "super_admin" && (
            <ComingSoonRow icon={Sparkles} label="Nova" hint="เรียนรู้ เติบโต เลเวลอัพ" />
          )}
          <ComingSoonRow icon={Files} label="คลังเอกสาร" hint="รวมเอกสารทั้งหมดไว้ในที่เดียว" />
        </div>

        {/* Appearance — everyone (spec 190). Light by default (sun-first); dark
            is opt-in. ระบบ follows the device. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">การแสดงผล</h2>
          <ThemeToggle initial={themeSetting} />
        </div>

        {/* Help / feedback — everyone (spec 193). Report a bug or ask for a
            feature; the form auto-attaches role/version/device for the team. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">ความช่วยเหลือ</h2>
          <SettingsLink
            href="/feedback"
            icon={MessageSquarePlus}
            label="แจ้งปัญหา / ขอฟีเจอร์"
            hint="พบข้อผิดพลาด หรืออยากให้ระบบทำอะไรได้เพิ่ม"
            badge={<ApprovalsBadge count={unreadFeedback} position="inline" label="ตอบกลับใหม่" />}
          />
          {/* Spec 193 U3: the operator's triage backlog — every report filed,
              with status control. super_admin only (RLS reads all). */}
          {role === "super_admin" && (
            <SettingsLink
              href="/feedback/review"
              icon={Inbox}
              label="รายการที่แจ้งเข้ามา"
              hint="ดูและจัดการคำขอ/ปัญหาที่ผู้ใช้แจ้ง"
              badge={<ApprovalsBadge count={openFeedback} position="inline" label="รอตรวจ" />}
            />
          )}
        </div>

        {/* Spec 212: daily-report Flex preview — operator only. Sends a sample
            report to the caller's OWN LINE (no guessed recipient) to validate the
            bubble layout before the feature is wired for the team. */}
        {role === "super_admin" && (
          <div className="flex flex-col gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">รายงานประจำวัน (ทดสอบ)</h2>
            <div className="border-edge bg-card rounded-control flex flex-col gap-2 border px-4 py-3">
              <p className="text-ink-secondary text-meta">
                ส่งรายงานตัวอย่างเข้า LINE ของคุณ เพื่อดูรูปแบบจริงก่อนเปิดใช้งานจริง
              </p>
              <DailyReportPreviewButton />
            </div>
          </div>
        )}

        {/* Admin — super_admin only (spec 220 / ADR 0050). In-app role assignment
            replaces out-of-band SQL promotion. */}
        {role === "super_admin" && (
          <div className="flex flex-col gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">ผู้ดูแลระบบ</h2>
            <SettingsLink
              href="/settings/roles"
              icon={ShieldCheck}
              label="จัดการสิทธิ์ผู้ใช้"
              hint="กำหนด/เปลี่ยน role ของผู้ใช้ในระบบ"
            />
            <SettingsLink
              href="/settings/usage"
              icon={Activity}
              label="การใช้งานแอป (หน้างาน)"
              hint="ดูว่าทีมงานหน้างานใช้แอปมากน้อยแค่ไหน เพื่อช่วยเหลือคนที่อาจติดขัด"
            />
          </div>
        )}

        {/* About — everyone */}
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-secondary font-semibold">เกี่ยวกับ</h2>
          <div className="border-edge bg-card rounded-control flex items-center justify-between border px-4 py-3">
            <span className="text-ink text-body font-semibold">PRC Ops</span>
            <span className="text-ink-secondary text-meta font-mono">เวอร์ชัน {pkg.version}</span>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

function SettingsLink({
  href,
  icon: Icon,
  label,
  hint,
  badge,
}: {
  href: string;
  icon: typeof Contact;
  label: string;
  hint: string;
  // Optional trailing awareness pill (spec 201 A2) — sits before the chevron.
  badge?: ReactNode;
}) {
  return (
    <Link href={href} className={ROW}>
      <span className="bg-sunk text-ink-secondary rounded-control inline-flex h-9 w-9 shrink-0 items-center justify-center">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink text-body block font-semibold">{label}</span>
        <span className="text-ink-secondary text-meta block">{hint}</span>
      </span>
      {badge}
      <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
    </Link>
  );
}

// Spec 98: a settings row for a not-yet-built menu — greyed, non-link, carries
// the เร็วๆนี้ badge where the chevron normally sits.
function ComingSoonRow({
  icon: Icon,
  label,
  hint,
}: {
  icon: typeof Contact;
  label: string;
  hint: string;
}) {
  return (
    <div
      aria-disabled="true"
      className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
    >
      <span className="bg-sunk text-ink-muted rounded-control inline-flex h-9 w-9 shrink-0 items-center justify-center">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink-secondary text-body block font-semibold">{label}</span>
        <span className="text-ink-muted text-meta block">{hint}</span>
      </span>
      <ComingSoonBadge />
    </div>
  );
}
