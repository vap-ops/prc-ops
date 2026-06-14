import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Contact, HardHat, Wallet } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/avatar-surface";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { createClient } from "@/lib/db/server";

// ตั้งค่า (Settings) hub — the back-office + account home. Declutters the bottom
// bar: the daily-decision surfaces stay as tabs; reference data (contacts,
// workers), finance (payroll), and the account (profile + logout) live here.
// Reachable by every authenticated role (like /profile — getClaims, not
// requireRole, so unserved roles aren't bounced). Master-data + finance sections
// are PM/super only. (A "ผลงานของฉัน"/performance section will slot under บัญชี.)

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
  const isManager = role === "project_manager" || role === "super_admin";

  return (
    <PageShell>
      <BottomTabBar role={role} />
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

        {isManager && (
          <>
            {/* Master data — PM/super */}
            <div className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">ข้อมูลหลัก</h2>
              <SettingsLink
                href="/contacts"
                icon={Contact}
                label="ติดต่อ"
                hint="ลูกค้า · ผู้ขาย · ผู้รับเหมา · ผู้ให้บริการ"
              />
              <SettingsLink href="/workers" icon={HardHat} label="คนงาน" hint="ทะเบียนคนงาน DC" />
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
            </div>
          </>
        )}
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
