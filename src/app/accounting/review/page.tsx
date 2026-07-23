// Spec 345 U2 — /accounting/review: the money-event review queue. Every money
// event across the 15 allowlisted sources, LEFT JOIN its review (absent row =
// pending), in four tabs. Reads via the SECURITY DEFINER RPC on the
// AUTHENTICATED session (NOT the admin client — the DB gate reads the caller's
// role, and service-role has a NULL role the gate refuses). Rows deliberately
// carry no link yet: the voucher page is U3, and a door to a route that does
// not exist is a dead door (spec 313 lesson).

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { MONEY_REVIEW_HINT, MONEY_REVIEW_LABEL } from "@/lib/i18n/labels";
import { SECTION_HEADING, FIELD_INPUT, BUTTON_PRIMARY } from "@/lib/ui/classes";
import {
  REVIEW_TABS,
  type MoneySourceTable,
  type ReviewTabKey,
} from "@/lib/accounting/review-queue-view";
import {
  ReviewQueueList,
  type ReviewQueueRow,
} from "@/components/features/accounting/review-queue-list";

export const metadata = { title: MONEY_REVIEW_LABEL };

const PAGE_SIZE = 100;

interface ReviewPageProps {
  searchParams: Promise<{ tab?: string; m?: string; project?: string }>;
}

function asTab(raw: string | undefined): ReviewTabKey {
  const keys = REVIEW_TABS.map((t) => t.key);
  return keys.includes(raw as ReviewTabKey) ? (raw as ReviewTabKey) : "pending";
}

export default async function MoneyReviewPage({ searchParams }: ReviewPageProps) {
  const ctx = await requireRole(ACCOUNTING_ROLES);
  const { tab: qTab, m: qMonth, project: qProject } = await searchParams;
  const tab = asTab(qTab);
  const today = bangkokTodayIso();
  const month = /^\d{4}-\d{2}$/.test(qMonth ?? "") ? (qMonth as string) : today.slice(0, 7);
  const projectId = qProject || undefined;

  // The DB gate needs the CALLER's role — user-session client, not admin.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_money_events_for_review", {
    p_tab: tab,
    p_month: `${month}-01`,
    p_limit: PAGE_SIZE,
    p_offset: 0,
    ...(projectId ? { p_project: projectId } : {}),
  });
  if (error) throw new Error(`list_money_events_for_review: ${error.message}`);

  const rows: ReviewQueueRow[] = (data ?? []).map((r) => ({
    sourceTable: r.source_table as MoneySourceTable,
    sourceId: r.source_id,
    projectId: r.project_id,
    projectName: r.project_name,
    amount: Number(r.amount ?? 0),
    eventDate: r.event_date,
    counterparty: r.counterparty,
    docCount: r.doc_count ?? 0,
    reviewStatus: r.review_status as ReviewQueueRow["reviewStatus"],
    openFlagCount: r.open_flag_count ?? 0,
    docsExpected: r.docs_expected as ReviewQueueRow["docsExpected"],
  }));

  const admin = createAdminClient();
  const { data: projectRows } = await admin.from("projects").select("id, code, name").order("name");
  const projects = projectRows ?? [];

  const withParams = (nextTab: ReviewTabKey) => {
    const q = new URLSearchParams();
    if (nextTab !== "pending") q.set("tab", nextTab);
    if (month !== today.slice(0, 7)) q.set("m", month);
    if (projectId) q.set("project", projectId);
    const s = q.toString();
    return s ? `/accounting/review?${s}` : "/accounting/review";
  };

  return (
    <>
      <DetailHeader backHref="/accounting" backLabel="บัญชี">
        <h1 className="text-foreground text-lg font-semibold">{MONEY_REVIEW_LABEL}</h1>
      </DetailHeader>
      <PageShell className={PAGE_MAX_W}>
        <p className="text-muted-foreground mb-4 text-sm">{MONEY_REVIEW_HINT}</p>

        <nav aria-label="มุมมอง" className="mb-4 flex flex-wrap gap-2">
          {REVIEW_TABS.map((t) => (
            <Link
              key={t.key}
              href={withParams(t.key)}
              aria-current={t.key === tab ? "page" : undefined}
              className={
                t.key === tab
                  ? "bg-action text-on-fill rounded-full px-3 py-1.5 text-sm font-medium"
                  : "border-border text-muted-foreground rounded-full border px-3 py-1.5 text-sm"
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <form
          method="get"
          action="/accounting/review"
          className="mb-4 flex flex-wrap items-end gap-2"
        >
          {tab !== "pending" ? <input type="hidden" name="tab" value={tab} /> : null}
          <label className="text-muted-foreground flex flex-col gap-1 text-xs">
            เดือน
            <input type="month" name="m" defaultValue={month} className={FIELD_INPUT} />
          </label>
          <label className="text-muted-foreground flex flex-col gap-1 text-xs">
            โครงการ
            <select name="project" defaultValue={projectId ?? ""} className={FIELD_INPUT}>
              <option value="">ทุกโครงการ</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            ดู
          </button>
        </form>

        <h2 className={SECTION_HEADING}>
          {REVIEW_TABS.find((t) => t.key === tab)?.label}
          {rows.length >= PAGE_SIZE ? ` (${PAGE_SIZE} รายการแรก)` : ` (${rows.length})`}
        </h2>
        <ReviewQueueList rows={rows} />
      </PageShell>
      <BottomTabBar role={ctx.role} />
    </>
  );
}
