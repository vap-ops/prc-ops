// Spec 310 U3 — the office-expense surface (ค่าใช้จ่ายสำนักงาน). Office roles record
// a non-WP expense (optionally under a project), pick where the money came from,
// and see their own expenses with reimburse / receipt status. Reached via ตั้งค่า.
// Spec 373 — the finance scope: accounting/super_admin flip ของฉัน → ทั้งหมด to see
// EVERY user's expenses (validate documents + data → confirm → consolidate), with
// the spec-345 review status joined per row and a month filter for consolidation.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { safeBackHref } from "@/lib/nav/back-href";
import { ProjectLens } from "@/components/features/common/project-lens";
import { AddExpenseFab } from "@/components/features/expenses/add-expense-fab";
import { AllExpenseList, ExpenseList } from "@/components/features/expenses/expense-list";
import { ExpenseScopeChips } from "@/components/features/expenses/expense-scope-chips";
import { ExpenseSummary } from "@/components/features/expenses/expense-summary";
import { ReimburseQueue } from "@/components/features/expenses/reimburse-queue";
import { requireRole } from "@/lib/auth/require-role";
import { OFFICE_EXPENSE_FINANCE_ROLES, OFFICE_EXPENSE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import {
  expenseMonthRange,
  resolveExpenseScope,
  type ExpenseScope,
} from "@/lib/expenses/expense-scope";
import {
  fetchOfficeExpenseReviewMap,
  listActiveProjectsForExpense,
  listAllExpenses,
  listExpenseCategories,
  listMyExpenses,
  listReimbursableExpenses,
  loadAllExpenseSummary,
  loadMyActiveCard,
  loadMyExpenseSummary,
  resolveUserNames,
  type AllExpenseRow,
  type OfficeExpenseReviewInfo,
} from "@/lib/expenses/load-office-expenses";
import type { ReviewedReimbursableRow } from "@/lib/expenses/reimburse-group";
import {
  EXPENSE_EXPORT_CSV_LABEL,
  EXPENSE_VERIFY_START_CTA,
  MONTH_FILTER_ALL,
  MONTH_FILTER_APPLY,
  MONTH_FILTER_LABEL,
  MONTH_FILTER_THIS,
  OFFICE_EXPENSE_NAV_LABEL,
} from "@/lib/i18n/labels";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { FIELD_INPUT, BUTTON_PRIMARY } from "@/lib/ui/classes";
import { UUID_REGEX } from "@/lib/validate/uuid";
import Link from "next/link";

export const metadata = { title: OFFICE_EXPENSE_NAV_LABEL };

interface ExpensesPageProps {
  // Nav-coherence audit 2026-07: `from` = the referrer-aware back chip (multi-parent
  // — reached from the /settings hub AND the /procurement Resources tile).
  searchParams: Promise<{
    project?: string | string[];
    from?: string | string[];
    scope?: string | string[];
    m?: string | string[];
  }>;
}

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const ctx = await requireRole(OFFICE_EXPENSE_ROLES);
  const supabase = await createClient();
  const isFinance = OFFICE_EXPENSE_FINANCE_ROLES.includes(ctx.role);

  // Spec 323 U4: the universal project lens (?project=). Non-UUID garbage is
  // treated as unfiltered rather than passed to a uuid-typed DB predicate; a
  // well-formed unknown id simply matches nothing (the /requests posture).
  const { project, from: rawFrom, scope: rawScope, m } = await searchParams;
  const projectParam = Array.isArray(project) ? project[0] : project;
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
  const projectId = projectParam && UUID_REGEX.test(projectParam) ? projectParam : undefined;

  // Spec 373 D1: the role gate lives in the resolver — a crafted ?scope=all
  // from a non-finance role resolves to "own" here, before any query runs.
  const scope = resolveExpenseScope(ctx.role, rawScope);
  const today = bangkokTodayIso();
  const range = expenseMonthRange(Array.isArray(m) ? m[0] : m, today);

  const [categories, projects, myCard] = await Promise.all([
    listExpenseCategories(supabase),
    listActiveProjectsForExpense(supabase),
    loadMyActiveCard(supabase, ctx.id),
  ]);

  // Spec 373 D2/D5 — review status + doc counts + docs-expected class for the
  // finance surfaces come from the spec-345 RPC on the AUTHED session (the DB
  // gate reads the caller's role; service-role is refused). Runs whenever
  // isFinance — the reimburse queue renders in both scopes. ⚠️ The RPC clamps
  // p_limit at 200 and orders oldest-first, so a single page would silently
  // mislabel every newer row "รอตรวจ" once the source outgrows 200 events
  // (fresh-eyes 🔴) — page with p_offset until a short page instead.
  // Spec 373 D2/D5 — review status + doc counts + docs-expected class from
  // the shared paged spec-345 helper, on the AUTHED session. Runs whenever
  // isFinance — the reimburse queue renders in both scopes.
  const reviewBySourceId = isFinance
    ? await fetchOfficeExpenseReviewMap(supabase)
    : new Map<string, OfficeExpenseReviewInfo>();

  // Spec 373 D5 — the queue rows carry their review + doc state (validate-
  // before-pay). Same RPC map as the list; absent row = pending by definition
  // for finance (office_expenses is an allowlisted spec-345 source). Group
  // names go through the admin seam too — the loader's authed `users` embed
  // nulls for an accounting viewer (D5 amendment).
  let reimbursable: ReviewedReimbursableRow[] = [];
  if (isFinance) {
    const rawQueue = await listReimbursableExpenses(supabase, projectId);
    const queueNames = await resolveUserNames(
      createAdminClient(),
      rawQueue.filter((r) => r.reimburseToName === null).map((r) => r.reimburseToUserId),
    );
    reimbursable = rawQueue.map((r) => {
      const review = reviewBySourceId.get(r.id);
      return {
        ...r,
        reimburseToName: r.reimburseToName ?? queueNames.get(r.reimburseToUserId) ?? null,
        reviewStatus: review?.status ?? "pending",
        docCount: review?.docCount ?? 0,
        docsExpected: review?.docsExpected ?? "expected",
      };
    });
  }

  // Spec 373 D1: chip/filter navigation keeps every live param.
  const withParams = (nextScope: ExpenseScope, nextMonth = range.month) => {
    const q = new URLSearchParams();
    if (nextScope === "all") {
      q.set("scope", "all");
      if (nextMonth !== today.slice(0, 7)) q.set("m", nextMonth);
    }
    if (projectId) q.set("project", projectId);
    if (from) q.set("from", from);
    const s = q.toString();
    return s ? `/expenses?${s}` : "/expenses";
  };

  let body: React.ReactNode;
  if (scope === "all") {
    // Spec 373 §6 — the verify chain's entry door: the OLDEST pending expense
    // firm-wide (the RPC's pending tab orders oldest-first), independent of the
    // month filter so the backlog can't hide behind a view. Count comes from
    // the map already in hand.
    const pendingCount = [...reviewBySourceId.values()].filter(
      (r) => r.status === "pending",
    ).length;
    const { data: oldestPending } = await supabase.rpc("list_money_events_for_review", {
      p_tab: "pending",
      p_limit: 1,
      p_offset: 0,
      p_source_table: "office_expenses",
    });
    const oldestPendingId = oldestPending?.[0]?.source_id ?? null;
    // Spec 373 D2 — names via the admin seam behind the requireRole gate
    // (users RLS is self-read-only for accounting; an authed embed would null
    // every name the viewer didn't submit).
    const admin = createAdminClient();
    const filters = {
      ...(projectId ? { projectId } : {}),
      ...(range.start ? { monthStart: range.start } : {}),
      ...(range.endExclusive ? { monthEndExclusive: range.endExclusive } : {}),
    };
    const [allList, allSummary] = await Promise.all([
      listAllExpenses(supabase, admin, filters),
      loadAllExpenseSummary(supabase, filters),
    ]);
    const rows: AllExpenseRow[] = allList.rows.map((r) => {
      const review = reviewBySourceId.get(r.id);
      return {
        ...r,
        docCount: review?.docCount ?? 0,
        reviewStatus: review?.status ?? "pending",
        docsExpected: review?.docsExpected ?? "expected",
      };
    });
    const monthMode =
      range.month === "all" ? "all" : range.month !== today.slice(0, 7) ? "selected" : "current";

    body = (
      <>
        {oldestPendingId && (
          <p>
            <Link
              href={`/accounting/review/office_expenses/${oldestPendingId}?from=${encodeURIComponent(withParams("all"))}`}
              className="bg-action text-on-fill inline-block rounded-full px-4 py-2 text-sm font-medium"
            >
              {EXPENSE_VERIFY_START_CTA} ({pendingCount})
            </Link>
          </p>
        )}
        <form method="get" action="/expenses" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="scope" value="all" />
          {projectId ? <input type="hidden" name="project" value={projectId} /> : null}
          {from ? <input type="hidden" name="from" value={from} /> : null}
          <label className="text-ink-secondary flex flex-col gap-1 text-xs">
            {MONTH_FILTER_LABEL}
            <input
              type="month"
              name="m"
              defaultValue={range.month === "all" ? "" : range.month}
              className={FIELD_INPUT}
            />
          </label>
          {range.month === "all" ? (
            <Link
              href={withParams("all", today.slice(0, 7))}
              className="text-action pb-2 text-sm underline"
            >
              {MONTH_FILTER_THIS}
            </Link>
          ) : (
            <Link href={withParams("all", "all")} className="text-action pb-2 text-sm underline">
              {MONTH_FILTER_ALL}
            </Link>
          )}
          <button type="submit" className={BUTTON_PRIMARY}>
            {MONTH_FILTER_APPLY}
          </button>
          {/* Spec 373 §5 — CSV export. A formAction submit so the download carries
              the LIVE month input, not the last-applied range (fresh-eyes). */}
          <button
            type="submit"
            formAction="/expenses/export"
            className="text-action pb-2 text-sm underline"
          >
            {EXPENSE_EXPORT_CSV_LABEL}
          </button>
        </form>
        <ExpenseSummary
          summary={allSummary}
          allScope
          bySource={allSummary.bySource}
          monthMode={monthMode}
        />
        <AllExpenseList expenses={rows} fromHref={withParams("all")} capped={allList.capped} />
      </>
    );
  } else {
    const [summary, myExpenses] = await Promise.all([
      loadMyExpenseSummary(supabase, ctx.id, projectId),
      listMyExpenses(supabase, ctx.id, projectId),
    ]);
    body = (
      <>
        <ExpenseSummary summary={summary} />
        <ExpenseList expenses={myExpenses} />
      </>
    );
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/settings")} backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{OFFICE_EXPENSE_NAV_LABEL}</h1>
      </DetailHeader>

      {/* Spec 310 U7/U10 — the page is a dashboard (summary + category chart, then
          the list + the finance reimburse queue); recording moved into a FAB +
          bottom sheet so the data reads first (operator 2026-07-13). */}
      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        {/* Spec 323 U4: the universal cross-project lens — scopes the summary,
            the list, and the finance queue below (collapses at ≤1 project). */}
        <ProjectLens projects={projects} />
        {isFinance && <ExpenseScopeChips scope={scope} hrefFor={withParams} />}
        {body}
        {isFinance && <ReimburseQueue rows={reimbursable} fromHref={withParams(scope)} />}
      </section>

      <AddExpenseFab categories={categories} projects={projects} myCard={myCard} />
    </PageShell>
  );
}
