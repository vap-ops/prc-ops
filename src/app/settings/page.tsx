import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Calculator,
  ChevronRight,
  Contact,
  Files,
  Hammer,
  HardHat,
  Sparkles,
  Store,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/common/avatar-surface";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { ComingSoonBadge } from "@/components/features/chrome/coming-soon-badge";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { createClient } from "@/lib/db/server";
import { ACCOUNTING_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { SUBCONTRACTOR_LABEL } from "@/lib/i18n/labels";
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
  // Spec 153: the desktop hub strip, like the sibling hubs (/projects, /review).
  // Phones leave via the bottom tab bar; unserved roles (hubItems null) get none.
  const hubItems = hubNavForRole(role);

  return (
    <PageShell>
      <BottomTabBar role={role} />
      {hubItems ? (
        <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/settings" />
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
          <div className="flex justify-end">
            <LogoutButton />
          </div>
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
          </div>
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
              <SettingsLink
                href="/contacts/crews"
                icon={Hammer}
                label={`${SUBCONTRACTOR_LABEL} / DC`}
                hint={`${SUBCONTRACTOR_LABEL} · DC ประจำ/ชั่วคราว/บริษัท`}
              />
              <SettingsLink href="/workers" icon={HardHat} label="ทีมงาน" hint="ทะเบียนทีมงาน DC" />
              <SettingsLink
                href="/equipment"
                icon={Wrench}
                label="อุปกรณ์"
                hint="ทะเบียนอุปกรณ์เช่า"
              />
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
}: {
  href: string;
  icon: typeof Contact;
  label: string;
  hint: string;
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
