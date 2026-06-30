// Spec 201 (review-kanban refinement) — the reporter's own submissions, on their own
// page. Split out from the submit form (/feedback): filing a new report and tracking
// past ones are different jobs. RLS scopes the read to submitted_by = auth.uid()
// (mig 20260813000000), so no filter here; each row links to its conversation.

import { redirect } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { MyFeedbackList } from "@/components/features/feedback/my-feedback-list";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { createClient } from "@/lib/db/server";

export const metadata = { title: "เรื่องที่เคยแจ้ง" };

export default async function MyFeedbackPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) redirect("/login");

  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", claimsData.claims.sub)
    .maybeSingle();
  if (!row) redirect("/login");

  const { data: mine } = await supabase
    .from("feedback")
    .select("id, feedback_number, type, status, title, created_at")
    .order("created_at", { ascending: false });

  // Spec 201 A2 — which of these reports have a team reply the reporter hasn't seen
  // (feedback_unread_ids, definer, caller-scoped). Best-effort: on failure no dots.
  const { data: unreadIds } = await supabase.rpc("feedback_unread_ids");
  const unread = new Set(unreadIds ?? []);

  const myFeedback = (mine ?? []).map((f) => ({
    id: f.id,
    feedbackNumber: f.feedback_number,
    type: f.type,
    status: f.status,
    title: f.title,
    createdAt: f.created_at,
    hasUnreadReply: unread.has(f.id),
  }));

  return (
    <PageShell>
      <BottomTabBar role={row.role} />
      <DetailHeader backHref="/feedback" backLabel="กลับ">
        <h1 className="text-ink text-xl font-semibold tracking-tight">เรื่องที่เคยแจ้ง</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <MyFeedbackList items={myFeedback} />
      </section>
    </PageShell>
  );
}
