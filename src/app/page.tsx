import { PageShell } from "@/components/features/chrome/page-shell";
import { redirect } from "next/navigation";
import { roleHome } from "@/lib/auth/role-home";
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
      redirect(roleHome(row.role));
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
