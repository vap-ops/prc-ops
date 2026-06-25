// Spec 201 U2 — a feedback report's conversation. The reporter reaches it from
// their own list (เรื่องที่เคยแจ้ง); the operator reaches it from the review list.
// Both read the report + its thread via their RLS context (own-or-super_admin); a
// row they cannot see resolves to notFound. The super_admin operator also gets the
// reply composer (post_feedback_message is super-only). Reporter-reply is U3.

import { redirect, notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { FeedbackThread } from "@/components/features/feedback/feedback-thread";
import { FeedbackReply } from "@/components/features/feedback/feedback-reply";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { createClient } from "@/lib/db/server";
import { FEEDBACK_TYPE_LABEL, FEEDBACK_STATUS_LABEL, formatThaiDateTime } from "@/lib/i18n/labels";

export const metadata = { title: "บทสนทนา · แจ้งปัญหา / ขอฟีเจอร์" };

const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
const TYPE_BADGE = {
  bug: "border-danger-edge bg-danger-soft text-danger-ink",
  feature: "border-action bg-action-soft text-action",
} as const;
const STATUS_BADGE = {
  open: "border-attn-edge bg-attn-soft text-attn-ink",
  in_progress: "border-action bg-action-soft text-action",
  done: "border-done-edge bg-done-soft text-done-ink",
  declined: "border-edge bg-sunk text-ink-secondary",
} as const;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function FeedbackDetailPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) redirect("/login");

  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", claimsData.claims.sub)
    .maybeSingle();
  if (!row) redirect("/login");

  // RLS scopes this to the submitter or super_admin — a row the viewer can't see
  // comes back null (not theirs / not found) → notFound.
  const { data: feedback } = await supabase
    .from("feedback")
    .select("id, type, status, title, body, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!feedback) notFound();

  const { data: msgs } = await supabase
    .from("feedback_messages")
    .select("id, author_kind, body, created_at")
    .eq("feedback_id", id)
    .order("created_at", { ascending: true });
  const messages = (msgs ?? []).map((m) => ({
    id: m.id,
    authorKind: m.author_kind,
    body: m.body,
    createdAt: m.created_at,
  }));

  const isSuper = row.role === "super_admin";

  return (
    <PageShell>
      <BottomTabBar role={row.role} />
      <DetailHeader backHref="/feedback" backLabel="กลับ">
        <h1 className="text-ink text-xl font-semibold tracking-tight">บทสนทนา</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <div className={`${CARD} flex flex-col gap-2`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${BADGE} ${TYPE_BADGE[feedback.type]}`}>
              {FEEDBACK_TYPE_LABEL[feedback.type]}
            </span>
            <span className={`${BADGE} ${STATUS_BADGE[feedback.status]}`}>
              {FEEDBACK_STATUS_LABEL[feedback.status]}
            </span>
            <span className="text-ink-muted ml-auto text-xs">
              {formatThaiDateTime(feedback.created_at)}
            </span>
          </div>
          <p className="text-ink text-base font-semibold">{feedback.title}</p>
          <p className="text-ink-secondary text-sm whitespace-pre-wrap">{feedback.body}</p>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-ink text-base font-semibold">การตอบกลับ</h2>
          <FeedbackThread messages={messages} />
        </div>

        {isSuper ? <FeedbackReply feedbackId={feedback.id} /> : null}
      </section>
    </PageShell>
  );
}
