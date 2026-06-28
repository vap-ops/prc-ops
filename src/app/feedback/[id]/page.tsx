// Spec 201 U2–U4 — a feedback report's conversation. The reporter reaches it from
// their own list (เรื่องที่เคยแจ้ง); the operator reaches it from the review list.
// Both read the report + its thread via their RLS context (own-or-super_admin); a
// row they cannot see resolves to notFound. Both ends may reply (U3 — the RPC derives
// the author voice). The super_admin operator also reviews CC's pending drafts and
// approves/discards them (U4); the reporter never sees a draft.

import { redirect, notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { FeedbackThread } from "@/components/features/feedback/feedback-thread";
import { FeedbackReply } from "@/components/features/feedback/feedback-reply";
import { FeedbackDrafts } from "@/components/features/feedback/feedback-drafts";
import { FeedbackAttachmentGallery } from "@/components/features/feedback/feedback-attachment-gallery";
import { MarkFeedbackViewed } from "@/components/features/feedback/mark-feedback-viewed";
import { loadFeedbackAttachmentUrls } from "@/lib/feedback/attachment-urls";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { safeBackHref } from "@/lib/nav/back-href";
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
  // The back chip follows where you came from — the operator review kanban or the
  // reporter's own list — falling back to the submit form (see safeBackHref).
  searchParams: Promise<{ from?: string }>;
}

export default async function FeedbackDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { from } = await searchParams;

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
    .select("id, type, status, title, body, created_at, submitted_by")
    .eq("id", id)
    .maybeSingle();
  if (!feedback) notFound();

  // Bug 8e9c9fc7 — surface the attached screenshots. Reading the feedback row above
  // means the viewer passed its RLS (own-or-super_admin), so they're authorised for
  // its attachments; loadFeedbackAttachmentUrls mints the signed URLs via the admin.
  const attachmentUrls = (await loadFeedbackAttachmentUrls([feedback.id])).get(feedback.id) ?? [];

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

  // U3 — both ends of the conversation may reply: the super_admin operator and the
  // report's own submitter. (The RPC derives the author voice from the caller.)
  const isSuper = row.role === "super_admin";
  const canReply = isSuper || feedback.submitted_by === claimsData.claims.sub;

  // U4 — pending CC drafts awaiting the operator's approval. RLS scopes the read to
  // super_admin, so the reporter never sees a draft even if this fetch ran for them.
  const drafts = isSuper
    ? (
        (
          await supabase
            .from("feedback_message_drafts")
            .select("id, body, created_at")
            .eq("feedback_id", id)
            .order("created_at", { ascending: true })
        ).data ?? []
      ).map((d) => ({ id: d.id, body: d.body, createdAt: d.created_at }))
    : [];

  return (
    <PageShell>
      <BottomTabBar role={row.role} />
      <DetailHeader backHref={safeBackHref(from, "/feedback")} backLabel="กลับ">
        <h1 className="text-ink text-xl font-semibold tracking-tight">บทสนทนา</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        {/* Spec 201 A2 — mark this report viewed (clears the unread-reply dot). */}
        <MarkFeedbackViewed feedbackId={feedback.id} />
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
          <FeedbackAttachmentGallery urls={attachmentUrls} />
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-ink text-base font-semibold">การตอบกลับ</h2>
          <FeedbackThread messages={messages} />
        </div>

        {isSuper ? <FeedbackDrafts drafts={drafts} /> : null}

        {canReply ? <FeedbackReply feedbackId={feedback.id} /> : null}
      </section>
    </PageShell>
  );
}
