// Spec 193 — แจ้งปัญหา / ขอฟีเจอร์. The feedback surface, drilled down from the
// ตั้งค่า hub (back chip → /settings). Reachable by every authenticated role
// (getClaims, like /profile) — anyone can report a bug or ask for a feature.

import { redirect } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { FeedbackForm } from "@/components/features/feedback/feedback-form";
import { MyFeedbackList } from "@/components/features/feedback/my-feedback-list";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { createClient } from "@/lib/db/server";

export const metadata = { title: "แจ้งปัญหา / ขอฟีเจอร์" };

export default async function FeedbackPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) redirect("/login");

  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", claimsData.claims.sub)
    .maybeSingle();
  if (!row) redirect("/login");

  // Spec 201 U1 — the reporter's own submissions, shown back to them. RLS scopes
  // this read to submitted_by = auth.uid() (mig 20260813000000), so no filter here.
  const { data: mine } = await supabase
    .from("feedback")
    .select("id, type, status, title, created_at")
    .order("created_at", { ascending: false });
  const myFeedback = (mine ?? []).map((f) => ({
    id: f.id,
    type: f.type,
    status: f.status,
    title: f.title,
    createdAt: f.created_at,
  }));

  return (
    <PageShell>
      <BottomTabBar role={row.role} />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">แจ้งปัญหา / ขอฟีเจอร์</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <p className="text-ink-secondary mb-5 text-sm">
          บอกเราว่าอะไรใช้ไม่ได้ หรือคุณอยากให้ระบบทำอะไรได้เพิ่ม — ทุกความคิดเห็นช่วยให้ระบบดีขึ้น
        </p>
        <FeedbackForm />
      </section>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 pb-10`}>
        <h2 className="text-ink mb-3 text-base font-semibold">เรื่องที่เคยแจ้ง</h2>
        <MyFeedbackList items={myFeedback} />
      </section>
    </PageShell>
  );
}
