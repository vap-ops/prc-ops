// Spec 310 U3 — the office-expense surface (ค่าใช้จ่ายสำนักงาน). Office roles record
// a non-WP expense (optionally under a project), pick where the money came from,
// and see their own expenses with reimburse / receipt status. Reached via ตั้งค่า.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { ProjectLens } from "@/components/features/common/project-lens";
import { AddExpenseFab } from "@/components/features/expenses/add-expense-fab";
import { ExpenseList } from "@/components/features/expenses/expense-list";
import { ExpenseSummary } from "@/components/features/expenses/expense-summary";
import { ReimburseQueue } from "@/components/features/expenses/reimburse-queue";
import { requireRole } from "@/lib/auth/require-role";
import { OFFICE_EXPENSE_FINANCE_ROLES, OFFICE_EXPENSE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import {
  listActiveProjectsForExpense,
  listExpenseCategories,
  listMyExpenses,
  listReimbursableExpenses,
  loadMyActiveCard,
  loadMyExpenseSummary,
} from "@/lib/expenses/load-office-expenses";
import { OFFICE_EXPENSE_NAV_LABEL } from "@/lib/i18n/labels";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { UUID_REGEX } from "@/lib/validate/uuid";

export const metadata = { title: OFFICE_EXPENSE_NAV_LABEL };

interface ExpensesPageProps {
  searchParams: Promise<{ project?: string | string[] }>;
}

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const ctx = await requireRole(OFFICE_EXPENSE_ROLES);
  const supabase = await createClient();
  const isFinance = OFFICE_EXPENSE_FINANCE_ROLES.includes(ctx.role);

  // Spec 323 U4: the universal project lens (?project=). Non-UUID garbage is
  // treated as unfiltered rather than passed to a uuid-typed DB predicate; a
  // well-formed unknown id simply matches nothing (the /requests posture).
  const { project } = await searchParams;
  const projectParam = Array.isArray(project) ? project[0] : project;
  const projectId = projectParam && UUID_REGEX.test(projectParam) ? projectParam : undefined;

  const [summary, categories, projects, myCard, myExpenses, reimbursable] = await Promise.all([
    loadMyExpenseSummary(supabase, ctx.id, projectId),
    listExpenseCategories(supabase),
    listActiveProjectsForExpense(supabase),
    loadMyActiveCard(supabase, ctx.id),
    listMyExpenses(supabase, ctx.id, projectId),
    isFinance ? listReimbursableExpenses(supabase, projectId) : Promise.resolve([]),
  ]);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{OFFICE_EXPENSE_NAV_LABEL}</h1>
      </DetailHeader>

      {/* Spec 310 U7/U10 — the page is a dashboard (summary + category chart, then
          the list + the finance reimburse queue); recording moved into a FAB +
          bottom sheet so the data reads first (operator 2026-07-13). */}
      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        {/* Spec 323 U4: the universal cross-project lens — scopes the summary,
            the list, and the finance queue below (collapses at ≤1 project). */}
        <ProjectLens projects={projects} />
        <ExpenseSummary summary={summary} />
        <ExpenseList expenses={myExpenses} />
        {isFinance && <ReimburseQueue rows={reimbursable} />}
      </section>

      <AddExpenseFab categories={categories} projects={projects} myCard={myCard} />
    </PageShell>
  );
}
