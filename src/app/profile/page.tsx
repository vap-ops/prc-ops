import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/avatar-surface";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { DisplayNameForm } from "@/components/features/display-name-form";
import { roleHome, type UserRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";

// Universal profile route — reachable by EVERY authenticated role, including
// visitor. Spec 07 / extends spec 05 / ADR 0017.
//
// Auth pattern mirrors /coming-soon (do NOT use requireRole — that would bounce
// unserved roles to their roleHome, which is /coming-soon for visitor and
// defeats the unit's purpose). The proxy already protects this path; the page
// double-checks defensively.
//
// Session check uses getClaims() — local JWT verify against cached JWKS, no
// Auth-server round-trip on the render path. See ADR 0021. The middleware
// keeps getUser() once per request for the authoritative refresh.

export const metadata = { title: "โปรไฟล์" };

export default async function ProfilePage() {
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
    console.error("[/profile] users row missing", { userId });
    redirect("/login");
  }

  const role = row.role as UserRole;
  const initialName = row.full_name ?? "";
  const backHref = roleHome(role);

  return (
    <main className="min-h-screen bg-white px-6 py-10 pb-20 text-zinc-900 sm:pb-10">
      <BottomTabBar role={role} />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="space-y-2">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 transition-colors hover:underline focus:outline-none focus-visible:underline"
          >
            <span aria-hidden="true">←</span> กลับ
          </Link>
          <div className="flex items-center gap-4 pt-1">
            <AvatarSurface lineUrl={row.line_avatar_url} fullName={row.full_name} size={64} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">โปรไฟล์</h1>
              <p className="text-sm text-zinc-600">แก้ไขชื่อที่แสดง</p>
            </div>
          </div>
        </header>

        <DisplayNameForm initialName={initialName} />

        <div className="flex justify-end pt-2">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
