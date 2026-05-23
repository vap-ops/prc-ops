import { redirect } from "next/navigation";
import { roleHome, type UserRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { LoginButton } from "./login/login-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: row } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (row) {
      redirect(roleHome(row.role as UserRole));
    }
    // Row missing (edge case): fall through to the unauth UI rather than guess.
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">PRC Ops</h1>
        <p className="text-lg text-zinc-400">
          Construction project operations platform. Currently in private development.
        </p>
        <p className="text-sm text-zinc-600">v1 launching with two pilot projects.</p>
        <div className="flex justify-center pt-2">
          <LoginButton />
        </div>
      </div>
    </main>
  );
}
