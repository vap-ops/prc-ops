import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/avatar-surface";
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

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name, line_avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (!row) {
    console.error("[/profile] users row missing", { userId: user.id });
    redirect("/login");
  }

  const role = row.role as UserRole;
  const initialName = row.full_name ?? "";
  const backHref = roleHome(role);

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="space-y-2">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            <span aria-hidden="true">←</span> Back
          </Link>
          <div className="flex items-center gap-4 pt-1">
            <AvatarSurface lineUrl={row.line_avatar_url} fullName={row.full_name} size={64} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
              <p className="text-sm text-zinc-500">Edit your display name.</p>
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
