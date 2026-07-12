import "server-only";

import type { createClient } from "@/lib/db/server";
import { OFFICE_EXPENSE_ROLES } from "@/lib/auth/role-home";

type DB = Awaited<ReturnType<typeof createClient>>;

export interface CompanyCard {
  id: string;
  label: string;
  holderUserId: string;
  holderName: string | null;
  last4: string | null;
  isActive: boolean;
}

export interface HolderOption {
  id: string;
  fullName: string | null;
}

// The card registry (superadmin). Cards ordered active-first, then by label.
export async function listCompanyCards(supabase: DB): Promise<CompanyCard[]> {
  const { data } = await supabase
    .from("company_cards")
    .select(
      "id, label, holder_user_id, last4, is_active, holder:users!company_cards_holder_user_id_fkey(full_name)",
    )
    .order("is_active", { ascending: false })
    .order("label", { ascending: true });

  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    holderUserId: r.holder_user_id,
    holderName: (r.holder as { full_name: string | null } | null)?.full_name ?? null,
    last4: r.last4,
    isActive: r.is_active,
  }));
}

// Candidate card holders — the office/HQ roles that carry a company card.
export async function listAssignableHolders(supabase: DB): Promise<HolderOption[]> {
  const { data } = await supabase
    .from("users")
    .select("id, full_name")
    .in("role", [...OFFICE_EXPENSE_ROLES])
    .order("full_name", { ascending: true });

  return (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name }));
}

export interface ExpenseCategory {
  id: string;
  labelTh: string;
}

export async function listExpenseCategories(supabase: DB): Promise<ExpenseCategory[]> {
  const { data } = await supabase
    .from("office_expense_categories")
    .select("id, label_th")
    .eq("is_active", true)
    .order("sort", { ascending: true });
  return (data ?? []).map((r) => ({ id: r.id, labelTh: r.label_th }));
}

export interface ProjectOption {
  id: string;
  name: string;
  code: string;
}

// Projects an expense may be attributed to (optional). RLS scopes visibility.
export async function listActiveProjectsForExpense(supabase: DB): Promise<ProjectOption[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, name, code")
    .order("code", { ascending: true });
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, code: r.code }));
}

export interface OfficeExpenseRow {
  id: string;
  description: string;
  amount: number;
  expenseDate: string;
  paymentSource: string;
  categoryLabel: string | null;
  projectName: string | null;
  cardLabel: string | null;
  reimburseToName: string | null;
  reimbursedAt: string | null;
  awaitingReceipt: boolean;
}

type OneOrArray<T> = T | T[] | null;
function one<T>(v: OneOrArray<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// The caller's own expenses (RLS restricts rows to own/finance; this scopes to own).
export async function listMyExpenses(supabase: DB, userId: string): Promise<OfficeExpenseRow[]> {
  const { data } = await supabase
    .from("office_expenses")
    .select(
      "id, description, amount, expense_date, payment_source, reimbursed_at, category:office_expense_categories!office_expenses_category_id_fkey(label_th), project:projects!office_expenses_project_id_fkey(name), card:company_cards!office_expenses_company_card_id_fkey(label), reimburse:users!office_expenses_reimburse_to_user_id_fkey(full_name), attachments:office_expense_attachments(id)",
    )
    .eq("submitted_by", userId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  return (data ?? []).map((r) => {
    const category = one(r.category as OneOrArray<{ label_th: string }>);
    const project = one(r.project as OneOrArray<{ name: string }>);
    const card = one(r.card as OneOrArray<{ label: string }>);
    const reimburse = one(r.reimburse as OneOrArray<{ full_name: string | null }>);
    const attachments = (r.attachments as { id: string }[] | null) ?? [];
    return {
      id: r.id,
      description: r.description,
      amount: r.amount,
      expenseDate: r.expense_date,
      paymentSource: r.payment_source,
      categoryLabel: category?.label_th ?? null,
      projectName: project?.name ?? null,
      cardLabel: card?.label ?? null,
      reimburseToName: reimburse?.full_name ?? null,
      reimbursedAt: r.reimbursed_at,
      awaitingReceipt: attachments.length === 0,
    };
  });
}
