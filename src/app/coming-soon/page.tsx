import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/common/avatar-surface";
import { DisplayNameForm } from "@/components/features/common/display-name-form";
import { createClient } from "@/lib/db/server";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { BUTTON_PRIMARY } from "@/lib/ui/classes";
import { comingSoonDecision, REGISTER_WORKSPACE_PATH } from "@/lib/auth/visitor-router";
import { getOwnTechnicianRegistration } from "@/lib/register/own-registration";

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
  // Spec 152 / ADR 0058: project_director is served (see-all PM) — same home.
  if (role === "project_director") redirect("/review");

  // Spec 264 G3 / ADR 0072 §8 — the context-aware visitor router. For a `visitor`
  // this page is a routing hub, not a dead wall: a visitor who already holds a
  // staff_registration (any status) is sent to their /register/technician
  // workspace (which renders pending/rejected and self-redirects on approval); an
  // organic visitor RENDERS the self-serve CTA below (never redirects — this page
  // is the visitor destination of roleHome, so a redirect back into the login/home
  // cycle would loop). Invites are NOT detected — token-held, unbound to the
  // visitor's uid (spec doc feasibility note); the invited person opens their link.
  // The staff_registration read is on the RLS session (own-row policy, G1).
  if (role === "visitor") {
    const registration = await getOwnTechnicianRegistration(supabase, userId);
    const decision = comingSoonDecision(role, registration !== null);
    if (decision.kind === "redirect") redirect(decision.to);
    if (decision.kind === "visitor-landing") {
      return (
        <VisitorLanding
          greeting={row.full_name ? `สวัสดี คุณ${row.full_name}` : "สวัสดี"}
          lineAvatarUrl={row.line_avatar_url}
          fullName={row.full_name}
        />
      );
    }
    // decision.kind === "static" is unreachable for a visitor, but fall through to
    // the shared static landing below if it ever were (defensive, no separate path).
  }

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
        <p className="text-ink-secondary text-lg">คุณเข้าสู่ระบบในบทบาท{displayName}</p>
        <p className="text-ink-secondary text-sm">
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
    <PageShell variant="bare" className="bg-card px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="space-y-1">
          <p className="text-action text-xs font-semibold tracking-wider uppercase">ศูนย์ควบคุม</p>
          <div className="flex items-center gap-3">
            <AvatarSurface lineUrl={lineAvatarUrl} fullName={fullName} size={48} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
              <p className="text-ink-secondary text-sm">เข้าสู่ระบบในบทบาท{displayName}</p>
            </div>
          </div>
        </header>

        <nav aria-label="เมนูศูนย์ควบคุม" className="flex flex-col gap-2">
          {HUB_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group rounded-card border-edge bg-card shadow-card hover:bg-sunk focus-visible:ring-action flex items-start justify-between gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-ink text-base font-medium">{link.label}</p>
                <p className="text-ink-secondary text-xs">{link.hint}</p>
              </div>
              <span
                aria-hidden="true"
                className="text-ink-muted group-hover:text-ink-secondary mt-0.5 shrink-0 transition-colors"
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

// Spec 264 G3 / ADR 0072 §8 — the organic-visitor landing. A real destination,
// not a dead wall: a primary CTA to self-register as a technician (the open
// self-serve entry, the only open one — external audiences arrive by invite, ADR
// 0072 §1), plus a secondary note for someone who was INVITED as a
// subcontractor/client to open the link they were sent (no self-select of
// client/subcon here — those relationships are invite-gated, not self-declared).
interface VisitorLandingProps {
  greeting: string;
  lineAvatarUrl: string | null;
  fullName: string | null;
}

function VisitorLanding({ greeting, lineAvatarUrl, fullName }: VisitorLandingProps) {
  return (
    <PageShell variant="card">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <AvatarSurface lineUrl={lineAvatarUrl} fullName={fullName} size={72} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-ink-secondary text-lg">ยินดีต้อนรับสู่ PRC Ops</p>
        <div className="space-y-3">
          <Link href={REGISTER_WORKSPACE_PATH} className={`${BUTTON_PRIMARY} w-full`}>
            สมัครเป็นช่าง
          </Link>
          <p className="text-ink-secondary text-sm">
            ได้รับลิงก์เชิญเป็นผู้รับเหมา/ลูกค้า? เปิดลิงก์ที่ได้รับ
          </p>
        </div>
        <div className="flex justify-center pt-2">
          <LogoutButton />
        </div>
      </div>
    </PageShell>
  );
}
