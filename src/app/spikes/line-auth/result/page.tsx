// Spike: LINE custom-flow auth — Step 3 of 3 (proof of session).
// See spikes/line-auth-FINDINGS.md. Throwaway exploratory code.

import { createClient as createServerSupabase } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export default async function SpikeLineAuthResultPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  let publicUsersRow: {
    id: string;
    role: string;
    full_name: string | null;
    line_user_id: string | null;
  } | null = null;
  let publicUsersError: string | null = null;

  if (user) {
    const { data, error } = await supabase
      .from("users")
      .select("id, role, full_name, line_user_id")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      publicUsersError = error.message;
    } else {
      publicUsersRow = data;
    }
  }

  const proof = {
    session_exists: Boolean(user),
    auth_user_id: user?.id ?? null,
    auth_email: user?.email ?? null,
    auth_user_metadata: user?.user_metadata ?? null,
    get_user_error: userError?.message ?? null,
    public_users_row: publicUsersRow,
    public_users_error: publicUsersError,
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12 font-mono text-sm text-zinc-100">
      <h1 className="mb-4 text-xl font-semibold">spike: line-auth result</h1>
      <p className="mb-6 text-zinc-400">
        Server-rendered proof. If <code>session_exists</code> is true and{" "}
        <code>public_users_row.id</code> matches <code>auth_user_id</code>, the custom-flow auth
        into a Supabase session works end-to-end.
      </p>
      <pre className="rounded border border-zinc-800 bg-zinc-900 p-4 whitespace-pre-wrap">
        {JSON.stringify(proof, null, 2)}
      </pre>
    </main>
  );
}
