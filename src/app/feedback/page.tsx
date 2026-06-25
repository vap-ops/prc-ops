// Spec 193 — แจ้งปัญหา / ขอฟีเจอร์. The feedback surface, drilled down from the
// ตั้งค่า hub (back chip → /settings). Reachable by every authenticated role
// (getClaims, like /profile) — anyone can report a bug or ask for a feature.
//
// Spec 201 (review-kanban refinement): this page is now the SUBMIT surface only.
// The reporter's own submissions moved to their own page (/feedback/mine) — filing a
// new report and tracking past ones are different jobs and were cramped together.

import { redirect } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { FeedbackForm } from "@/components/features/feedback/feedback-form";
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

        <Link
          href="/feedback/mine"
          className="text-action mt-6 inline-block text-sm font-medium underline-offset-2 hover:underline"
        >
          เรื่องที่เคยแจ้ง →
        </Link>
      </section>
    </PageShell>
  );
}
