import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { createClient } from "@/lib/db/server";
import { type UserRole } from "@/lib/auth/role-home";

// Display labels for every role that lands here. site_admin and project_manager
// are redirected away (their landings exist), so they're intentionally absent.
const UNSERVED_ROLE_LABEL: Record<Exclude<UserRole, "site_admin" | "project_manager">, string> = {
  visitor: "Visitor",
  super_admin: "Super Admin",
  project_coordinator: "Project Coordinator",
  procurement: "Procurement",
  technician: "Technician",
  hr: "HR",
  subcon_manager: "Subcontractor Manager",
  accounting: "Accounting",
};

export default async function ComingSoonPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!row) {
    console.error("[/coming-soon] users row missing", { userId: user.id });
    redirect("/login");
  }

  const role = row.role as UserRole;

  // Bounce served roles to their proper home. Each branch ends in redirect()
  // which returns `never`, so after these two lines `role` is narrowed to the
  // unserved-role union — exactly the keys of UNSERVED_ROLE_LABEL.
  if (role === "site_admin") redirect("/sa");
  if (role === "project_manager") redirect("/pm");

  const displayName = UNSERVED_ROLE_LABEL[role] ?? role;
  const greeting = row.full_name ?? "there";

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Hi, {greeting}</h1>
        <p className="text-lg text-zinc-400">You&apos;re signed in as {displayName}.</p>
        <p className="text-sm text-zinc-500">
          PRC Ops is rolling out features in phases. Tools for your role aren&apos;t ready yet —
          we&apos;ll let you know when they go live. For now, please continue using your current
          process.
        </p>
        <div className="flex justify-center pt-2">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
