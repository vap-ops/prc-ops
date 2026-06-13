import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/avatar-surface";
import { DisplayNameForm } from "@/components/features/display-name-form";
import { createClient } from "@/lib/db/server";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: "เร็ว ๆ นี้" };

// Session check uses getClaims() — local JWT verify against the cached JWKS,
// no Auth-server round-trip on the render path. See ADR 0021. The middleware
// keeps getUser() once per request for the authoritative refresh.

export default async function ComingSoonPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) {
    redirect("/login");
  }
  const userId = claimsData.claims.sub;

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name, line_avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (!row) {
    console.error("[/coming-soon] users row missing", { userId });
    redirect("/login");
  }

  const role = row.role;

  // Bounce served roles to their proper home. Each branch ends in redirect()
  // which returns `never`, so after these two lines `role` is narrowed to the
  // unserved-role union — exactly the keys of UNSERVED_ROLE_LABEL.
  if (role === "site_admin") redirect("/projects");
  if (role === "project_manager") redirect("/review");

  const displayName = USER_ROLE_LABEL[role] ?? role;
  const greeting = row.full_name ? `สวัสดี คุณ${row.full_name}` : "สวัสดี";
  const initialName = row.full_name ?? "";
  const lineAvatarUrl = row.line_avatar_url;

  // super_admin is the only "unserved" role that genuinely needs to
  // *reach* the served surfaces — every other unserved role waits for
  // its own tools to ship. Give super_admin an operator hub instead of
  // the wait-for-tools copy. /projects and /review both admit super_admin
  // via their existing requireRole() guards (no auth change in this
  // unit; this is purely a render branch).
  if (role === "super_admin") {
    return (
      <OperatorHub
        greeting={greeting}
        displayName={displayName}
        initialName={initialName}
        lineAvatarUrl={lineAvatarUrl}
        fullName={row.full_name}
      />
    );
  }

  return (
    <PageShell variant="card">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <AvatarSurface lineUrl={lineAvatarUrl} fullName={row.full_name} size={72} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-lg text-zinc-600">คุณเข้าสู่ระบบในบทบาท{displayName}</p>
        <p className="text-sm text-zinc-600">
          PRC Ops กำลังทยอยเปิดใช้งานทีละส่วน เครื่องมือสำหรับบทบาทของคุณยังไม่พร้อมใช้งาน —
          เมื่อเปิดใช้แล้วเราจะแจ้งให้ทราบ ระหว่างนี้กรุณาใช้ช่องทางการทำงานเดิมไปก่อน
        </p>
        <div className="text-left">
          <DisplayNameForm initialName={initialName} />
        </div>
        <div className="flex justify-center pt-2">
          <LogoutButton />
        </div>
      </div>
    </PageShell>
  );
}

interface OperatorHubProps {
  greeting: string;
  displayName: string;
  initialName: string;
  lineAvatarUrl: string | null;
  fullName: string | null;
}

interface HubLink {
  href: string;
  label: string;
  hint: string;
}

const HUB_LINKS: ReadonlyArray<HubLink> = [
  // Spec 82 Unit 3: the two project hubs (/sa, /pm/projects) folded into one
  // /projects hub — a single operator-hub entry now, not two.
  {
    href: "/projects",
    label: "โครงการ",
    hint: "รายการโครงการ รายการงาน รูปถ่าย และรายงาน",
  },
  {
    href: "/review",
    label: "รายการรอตรวจ",
    hint: "รายการงานที่รอผู้จัดการโครงการตรวจสอบ",
  },
  {
    href: "/requests",
    label: "คำขอซื้อ",
    hint: "พิจารณาคำขอซื้อที่รออนุมัติ และติดตามทุกคำขอ — คำขอใหม่เริ่มจากหน้ารายการงาน",
  },
  {
    href: "/profile",
    label: "โปรไฟล์",
    hint: "แก้ไขชื่อที่แสดง",
  },
];

function OperatorHub({
  greeting,
  displayName,
  initialName,
  lineAvatarUrl,
  fullName,
}: OperatorHubProps) {
  return (
    <PageShell variant="bare" className="bg-white px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold tracking-wider text-blue-700 uppercase">
            ศูนย์ควบคุม
          </p>
          <div className="flex items-center gap-3">
            <AvatarSurface lineUrl={lineAvatarUrl} fullName={fullName} size={48} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
              <p className="text-sm text-zinc-600">เข้าสู่ระบบในบทบาท{displayName}</p>
            </div>
          </div>
        </header>

        <nav aria-label="เมนูศูนย์ควบคุม" className="flex flex-col gap-2">
          {HUB_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-base font-medium text-zinc-900">{link.label}</p>
                <p className="text-xs text-zinc-600">{link.hint}</p>
              </div>
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-600"
              >
                →
              </span>
            </Link>
          ))}
        </nav>

        <DisplayNameForm initialName={initialName} />

        <div className="flex justify-end pt-2">
          <LogoutButton />
        </div>
      </div>
    </PageShell>
  );
}
