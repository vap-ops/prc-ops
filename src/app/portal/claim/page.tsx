// Spec 130 U3 / ADR 0051 — invite claim. A PM sends /portal/claim?token=… ; the
// contractor opens it, logs in via LINE (new signup → role `visitor`), and
// confirms to bind + become a `contractor`. Reachable by a visitor (so NOT
// requireRole(["contractor"]) — that would bounce a fresh signup to
// /coming-soon); gated only on being signed in. An already-bound contractor is
// sent straight to the portal.

import { redirect } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { EmptyNotice } from "@/components/features/common/notices";
import { createClient } from "@/lib/db/server";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { ClaimButton } from "@/components/features/portal/claim-button";

export const metadata = { title: "รับสิทธิ์เข้าใช้งาน" };

interface ClaimPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ClaimPage({ searchParams }: ClaimPageProps) {
  const { token } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  if (!data) redirect("/login");

  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (row?.role === "contractor") redirect("/portal");

  return (
    <PageShell>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>รับสิทธิ์เข้าใช้งาน</h1>
        {token ? (
          <div className={`${CARD} flex flex-col gap-4`}>
            <p className="text-ink-secondary text-sm">
              กดยืนยันเพื่อเชื่อมบัญชีของคุณกับผู้รับเหมาและเข้าใช้งานพอร์ทัล
            </p>
            <ClaimButton token={token} />
          </div>
        ) : (
          <EmptyNotice>ลิงก์ไม่ถูกต้อง — กรุณาขอลิงก์ใหม่จากผู้จัดการโครงการ</EmptyNotice>
        )}
      </section>
    </PageShell>
  );
}
