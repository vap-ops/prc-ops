import { PageShell } from "@/components/features/chrome/page-shell";
import { redirect } from "next/navigation";
import { roleHome } from "@/lib/auth/role-home";
import { BANNER_ERROR } from "@/lib/ui/classes";
import { createClient } from "@/lib/db/server";
import { LoginButton } from "./login-button";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  session_failed: "ไม่สามารถเริ่มเซสชันได้ กรุณาลองใหม่อีกครั้ง",
  unknown: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
};

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; handoff?: string }>;
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
    redirect(row ? roleHome(row.role) : "/coming-soon");
  }

  const params = await searchParams;
  const errorMessage = params.error
    ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.unknown)
    : null;
  // Spec 43: the handoff callback drops the user in a browser tab that
  // holds no session — tell them to return to the installed app.
  const handoffApproved = params.handoff === "approved";

  return (
    <PageShell variant="card">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">PRC Ops</h1>
        <p className="text-ink-secondary text-sm">
          เข้าสู่ระบบด้วยบัญชี LINE ของคุณเพื่อเข้าใช้งาน
        </p>
        {handoffApproved && (
          <div
            role="status"
            data-testid="login-handoff-success"
            className="border-done-edge bg-done-soft text-done-ink rounded border px-4 py-3 text-sm"
          >
            เข้าสู่ระบบสำเร็จแล้ว กลับไปที่แอปบนหน้าจอหลักได้เลย
          </div>
        )}
        {errorMessage && (
          <div role="alert" data-testid="login-error" className={BANNER_ERROR}>
            {errorMessage}
          </div>
        )}
        <LoginButton />
      </div>
    </PageShell>
  );
}
