import { redirect } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { EmptyNotice } from "@/components/features/common/notices";
import { createClient } from "@/lib/db/server";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { ClientClaimButton } from "@/components/features/client-portal/client-claim-button";

export const metadata = { title: "รับสิทธิ์เข้าชมความคืบหน้าโครงการ" };

interface ClientClaimPageProps {
  searchParams: Promise<{ token?: string }>;
}

// Spec 233 / ADR 0067 (mirrors /portal/claim). Reachable by a signed-in visitor
// — NOT requireRole(["client"]), because a fresh LINE signup is role `visitor`
// and would bounce to /coming-soon. Gated only on being signed in. An already-
// bound client is sent straight to /client. ClientClaimButton confirms →
// claim_client_invite → /client.
export default async function ClientClaimPage({ searchParams }: ClientClaimPageProps) {
  const { token } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  if (!data) redirect("/login");

  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (row?.role === "client") redirect("/client");

  return (
    <PageShell>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>รับสิทธิ์เข้าชมความคืบหน้าโครงการ</h1>
        {token ? (
          <div className={`${CARD} flex flex-col gap-4`}>
            <p className="text-ink-secondary text-sm">
              กดยืนยันเพื่อเข้าชมความคืบหน้าของโครงการที่คุณได้รับเชิญ
            </p>
            <ClientClaimButton token={token} />
          </div>
        ) : (
          <EmptyNotice>ลิงก์ไม่ถูกต้อง — กรุณาขอลิงก์ใหม่จากผู้อำนวยการโครงการ</EmptyNotice>
        )}
      </section>
    </PageShell>
  );
}
