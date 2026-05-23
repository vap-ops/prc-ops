import { redirect } from "next/navigation";
import { roleHome, type UserRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { LoginButton } from "./login-button";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "Sign-in didn't complete. Please try again.",
  session_failed: "We couldn't establish your session. Please try again.",
  unknown: "Something went wrong. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
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
    redirect(row ? roleHome(row.role as UserRole) : "/coming-soon");
  }

  const params = await searchParams;
  const errorMessage = params.error
    ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.unknown)
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">PRC Ops</h1>
        <p className="text-sm text-zinc-400">Sign in with your LINE account to continue.</p>
        {errorMessage && (
          <div
            role="alert"
            className="rounded border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200"
          >
            {errorMessage}
          </div>
        )}
        <LoginButton />
      </div>
    </main>
  );
}
