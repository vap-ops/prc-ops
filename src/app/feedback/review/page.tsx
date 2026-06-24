// Spec 193 U3 — the super_admin feedback backlog. The deferred in-app review list
// (until now CC read the table via `supabase db query`). Lists every report
// newest-first with the auto-captured triage context (role / version / device /
// page / screen) and any attached screenshots, and lets the operator move each
// through its lifecycle (open → in_progress → done / declined) via the status RPC.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { FeedbackStatusControl } from "@/components/features/feedback/feedback-status-control";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import {
  FEEDBACK_TYPE_LABEL,
  FEEDBACK_STATUS_LABEL,
  USER_ROLE_LABEL,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

export const metadata = { title: "รายการแจ้งปัญหา / ขอฟีเจอร์" };

type FeedbackStatus = Database["public"]["Enums"]["feedback_status"];
type FeedbackType = Database["public"]["Enums"]["feedback_type"];

const TYPE_BADGE: Record<FeedbackType, string> = {
  bug: "border-danger-edge bg-danger-soft text-danger-ink",
  feature: "border-action bg-action-soft text-action",
};

const STATUS_BADGE: Record<FeedbackStatus, string> = {
  open: "border-attn-edge bg-attn-soft text-attn-ink",
  in_progress: "border-action bg-action-soft text-action",
  done: "border-done-edge bg-done-soft text-done-ink",
  declined: "border-edge bg-sunk text-ink-secondary",
};

const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";

// A compact device read from the user-agent — the operator wants mobile-vs-desktop
// at a glance (the full string is on hover).
function deviceLabel(ua: string | null): string {
  if (!ua) return "—";
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? "มือถือ" : "เดสก์ท็อป";
}

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
  const urlsByAttachment = new Map<string, string>();
  const attachmentsByFeedback = new Map<string, Array<{ id: string }>>();
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
      if (url) urlsByAttachment.set(a.id, url);
      const list = attachmentsByFeedback.get(a.feedback_id) ?? [];
      list.push({ id: a.id });
      attachmentsByFeedback.set(a.feedback_id, list);
    }
  }

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
          <ul className="flex flex-col gap-3">
            {feedback.map((f) => {
              const atts = attachmentsByFeedback.get(f.id) ?? [];
              return (
                <li key={f.id} className={`${CARD} flex flex-col gap-3`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`${BADGE} ${TYPE_BADGE[f.type]}`}>
                      {FEEDBACK_TYPE_LABEL[f.type]}
                    </span>
                    <span className={`${BADGE} ${STATUS_BADGE[f.status]}`}>
                      {FEEDBACK_STATUS_LABEL[f.status]}
                    </span>
                    <span className="text-ink-muted ml-auto text-xs">
                      {formatThaiDateTime(f.created_at)}
                    </span>
                  </div>

                  <div>
                    <p className="text-ink text-base font-semibold">{f.title}</p>
                    <p className="text-ink-secondary mt-1 text-sm whitespace-pre-wrap">{f.body}</p>
                  </div>

                  {atts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {atts.map((a, i) => {
                        const url = urlsByAttachment.get(a.id);
                        if (!url) return null;
                        return (
                          <a
                            key={a.id}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="focus-visible:ring-action rounded-control focus:outline-none focus-visible:ring-2"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`รูปแนบ ${i + 1}`}
                              className="rounded-control border-edge size-20 border object-cover"
                            />
                          </a>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* The triage context the reporter never typed (spec 193). */}
                  <dl className="text-ink-secondary grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-ink-muted">บทบาท</dt>
                    <dd>{USER_ROLE_LABEL[f.role_snapshot]}</dd>
                    <dt className="text-ink-muted">เวอร์ชัน</dt>
                    <dd className="font-mono">{f.app_version ?? "—"}</dd>
                    <dt className="text-ink-muted">อุปกรณ์</dt>
                    <dd title={f.user_agent ?? undefined}>{deviceLabel(f.user_agent)}</dd>
                    {f.screen ? (
                      <>
                        <dt className="text-ink-muted">หน้าจอ</dt>
                        <dd>{f.screen}</dd>
                      </>
                    ) : null}
                    {f.page_path ? (
                      <>
                        <dt className="text-ink-muted">เส้นทาง</dt>
                        <dd className="font-mono break-all">{f.page_path}</dd>
                      </>
                    ) : null}
                  </dl>

                  <FeedbackStatusControl id={f.id} status={f.status} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
