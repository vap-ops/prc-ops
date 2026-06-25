// Spec 193 U3 + spec 201 (review kanban) — the super_admin feedback triage board.
// Every report is a card under its lifecycle column (ใหม่ → กำลังดำเนินการ → เสร็จ /
// ปฏิเสธ); the card's status control moves it between columns, and each links to the
// full conversation. Reads all reports (mirrors the RLS: super reads all); attachment
// thumbnails are minted as short-lived signed URLs via the service-role admin.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import {
  FeedbackKanban,
  type FeedbackCardVM,
} from "@/components/features/feedback/feedback-kanban";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: "รายการแจ้งปัญหา / ขอฟีเจอร์" };

export default async function FeedbackReviewPage() {
  // Super-only — the operator's triage console (mirrors the RLS: super reads all).
  await requireRole(["super_admin"]);

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("feedback")
    .select(
      "id, type, status, title, body, screen, page_path, app_version, user_agent, role_snapshot, created_at",
    )
    .order("created_at", { ascending: false });
  const feedback = rows ?? [];

  // Attachments live behind zero authenticated access — read via the service-role
  // admin (we're already gated to super_admin) and mint short-lived signed URLs.
  const urlsByFeedback = new Map<string, string[]>();
  if (feedback.length > 0) {
    const admin = createAdminClient();
    const { data: atts } = await admin
      .from("feedback_attachments")
      .select("id, feedback_id, storage_path")
      .in(
        "feedback_id",
        feedback.map((f) => f.id),
      )
      .order("created_at", { ascending: true });
    const signed = await mintSignedUrls("feedback-attachments", atts ?? []);
    for (const a of atts ?? []) {
      const url = signed.get(a.id);
      if (!url) continue;
      const list = urlsByFeedback.get(a.feedback_id) ?? [];
      list.push(url);
      urlsByFeedback.set(a.feedback_id, list);
    }
  }

  const cards: FeedbackCardVM[] = feedback.map((f) => ({
    id: f.id,
    type: f.type,
    status: f.status,
    title: f.title,
    body: f.body,
    createdAt: f.created_at,
    roleSnapshot: f.role_snapshot,
    appVersion: f.app_version,
    userAgent: f.user_agent,
    screen: f.screen,
    pagePath: f.page_path,
    attachmentUrls: urlsByFeedback.get(f.id) ?? [],
  }));

  const openCount = feedback.filter((f) => f.status === "open").length;

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">แจ้งปัญหา / ขอฟีเจอร์</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-sm">
          ทั้งหมด {feedback.length} รายการ · ใหม่ {openCount} รายการ
        </p>

        {feedback.length === 0 ? (
          <EmptyNotice>ยังไม่มีรายการแจ้งเข้ามา</EmptyNotice>
        ) : (
          <FeedbackKanban cards={cards} />
        )}
      </section>
    </PageShell>
  );
}
