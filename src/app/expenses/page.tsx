// Spec 310 U3 — the office-expense surface (ค่าใช้จ่ายสำนักงาน). Office roles record
// a non-WP expense (optionally under a project), pick where the money came from,
// and see their own expenses with reimburse / receipt status. Reached via ตั้งค่า.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { ExpenseList } from "@/components/features/expenses/expense-list";
import { OfficeExpenseForm } from "@/components/features/expenses/office-expense-form";
import { ReimburseQueue } from "@/components/features/expenses/reimburse-queue";
import { requireRole } from "@/lib/auth/require-role";
import { OFFICE_EXPENSE_FINANCE_ROLES, OFFICE_EXPENSE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import {
  listActiveProjectsForExpense,
  listCompanyCards,
  listExpenseCategories,
  listMyExpenses,
  listReimbursableExpenses,
} from "@/lib/expenses/load-office-expenses";
import { OFFICE_EXPENSE_NAV_LABEL } from "@/lib/i18n/labels";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: OFFICE_EXPENSE_NAV_LABEL };

export default async function ExpensesPage() {
  const ctx = await requireRole(OFFICE_EXPENSE_ROLES);
  const supabase = await createClient();
  const isFinance = OFFICE_EXPENSE_FINANCE_ROLES.includes(ctx.role);

  const [categories, projects, cards, myExpenses, reimbursable] = await Promise.all([
    listExpenseCategories(supabase),
    listActiveProjectsForExpense(supabase),
    listCompanyCards(supabase),
    listMyExpenses(supabase, ctx.id),
    isFinance ? listReimbursableExpenses(supabase) : Promise.resolve([]),
  ]);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{OFFICE_EXPENSE_NAV_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        <OfficeExpenseForm
          categories={categories}
          projects={projects}
          cards={cards.filter((c) => c.isActive)}
        />
        {isFinance && <ReimburseQueue rows={reimbursable} />}
        <ExpenseList expenses={myExpenses} />
      </section>
    </PageShell>
  );
}
