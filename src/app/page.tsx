import { PageShell } from "@/components/features/chrome/page-shell";
import { redirect } from "next/navigation";
import { homePathForUser } from "@/lib/auth/resolve-home";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
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
      // A single-project site_admin lands on their project; others on roleHome.
      // Admin client: a deterministic, RLS-independent membership lookup by id.
      redirect(await homePathForUser(createAdminClient(), row.role, user.id));
    }
    // Row missing (edge case): fall through to the unauth UI rather than guess.
  }

  return (
    <PageShell variant="card">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">PRC Ops</h1>
        <p className="text-ink-secondary text-lg">
          ระบบบริหารงานก่อสร้าง — รูปถ่ายความคืบหน้า อนุมัติงาน และรายงานโครงการ
        </p>
        <p className="text-ink-secondary text-sm">เวอร์ชันแรก เริ่มใช้กับโครงการนำร่อง 2 โครงการ</p>
        <div className="flex justify-center pt-2">
          <LoginButton />
        </div>
      </div>
    </PageShell>
  );
}
