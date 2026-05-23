import { LogoutButton } from "@/components/auth/logout-button";
import { requireRole } from "@/lib/auth/require-role";

export default async function ProjectManagerLandingPage() {
  const ctx = await requireRole(["project_manager"]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Hi, {ctx.fullName ?? "there"}.</h1>
        <p className="text-lg text-zinc-400">You&apos;re signed in as Project Manager.</p>
        <p className="text-sm text-zinc-500">Approval queue coming soon.</p>
        <div className="flex justify-center pt-2">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
