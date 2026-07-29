import "server-only";

import type { createClient } from "@/lib/db/server";
import { OFFICE_EXPENSE_ROLES } from "@/lib/auth/role-home";
import { bangkokTodayIso } from "@/lib/dates";
import type { ReimbursableRow } from "@/lib/expenses/reimburse-group";
import {
  aggregateCategorySpend,
  aggregateSourceSpend,
  sumAmounts,
  type CategorySpend,
  type SourceSpend,
} from "@/lib/expenses/expense-summary";

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

// Spec 310 U8 — a user holds at most one active card. The /expenses form shows
// the company-card source only if this returns non-null, and auto-uses it (no
// picker). Returns the caller's active card, if any.
export async function loadMyActiveCard(supabase: DB, userId: string): Promise<CompanyCard | null> {
  const { data } = await supabase
    .from("company_cards")
    .select(
      "id, label, holder_user_id, last4, is_active, holder:users!company_cards_holder_user_id_fkey(full_name)",
    )
    .eq("holder_user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    label: data.label,
    holderUserId: data.holder_user_id,
    holderName: (data.holder as { full_name: string | null } | null)?.full_name ?? null,
    last4: data.last4,
    isActive: data.is_active,
  };
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
// Spec 323 U4: an active project lens narrows to that project's rows (DB
// predicate — a project-less office expense only shows under ทุกโครงการ).
export async function listMyExpenses(
  supabase: DB,
  userId: string,
  projectId?: string,
): Promise<OfficeExpenseRow[]> {
  let query = supabase
    .from("office_expenses")
    .select(
      "id, description, amount, expense_date, payment_source, reimbursed_at, category:office_expense_categories!office_expenses_category_id_fkey(label_th), project:projects!office_expenses_project_id_fkey(name), card:company_cards!office_expenses_company_card_id_fkey(label), reimburse:users!office_expenses_reimburse_to_user_id_fkey(full_name), attachments:office_expense_attachments(id)",
    )
    .eq("submitted_by", userId);
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query
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

// Spec 373 D2 — the firm-wide list for the finance scope (RLS admits
// accounting/super_admin on every row; everyone else still only matches their
// own — but the page's resolver never routes them here anyway). ⚠️ Names are
// resolved via the ADMIN client behind the page's requireRole gate: users RLS
// is self-read-only for accounting, so an authed `users` embed would null the
// submitter on every row the accountant didn't submit (fact-check 2026-07-29;
// spec-345 voucher precedent). Review status + doc counts are NOT read here —
// the page joins them from list_money_events_for_review (spec 345 SSOT).
export interface AllExpenseRow {
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
  submitterId: string;
  submitterName: string | null;
  docCount: number;
  reviewStatus: "pending" | "flagged" | "verified";
}

export type AllExpenseLoaderRow = Omit<AllExpenseRow, "docCount" | "reviewStatus">;

// Spec 373 — the shared admin-client name seam. `public.users` RLS is
// self-read-only for accounting, so ANY authed `users` embed on a finance
// surface nulls names the viewer didn't submit; every /expenses name read goes
// through here instead (behind the page's requireRole gate). Distinct ids, one
// query, empty input short-circuits.
export async function resolveUserNames(
  admin: DB,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const distinct = [...new Set(ids)];
  if (distinct.length === 0) return names;
  const { data } = await admin.from("users").select("id, full_name").in("id", distinct);
  for (const u of data ?? []) names.set(u.id, u.full_name);
  return names;
}

export const ALL_EXPENSES_CAP = 100;

export interface AllExpenseFilters {
  projectId?: string;
  monthStart?: string;
  monthEndExclusive?: string;
}

export async function listAllExpenses(
  supabase: DB,
  admin: DB,
  { projectId, monthStart, monthEndExclusive }: AllExpenseFilters,
): Promise<AllExpenseLoaderRow[]> {
  let query = supabase
    .from("office_expenses")
    .select(
      "id, description, amount, expense_date, payment_source, reimbursed_at, submitted_by, reimburse_to_user_id, category:office_expense_categories!office_expenses_category_id_fkey(label_th), project:projects!office_expenses_project_id_fkey(name), card:company_cards!office_expenses_company_card_id_fkey(label)",
    );
  if (projectId) query = query.eq("project_id", projectId);
  if (monthStart) query = query.gte("expense_date", monthStart);
  if (monthEndExclusive) query = query.lt("expense_date", monthEndExclusive);
  const { data } = await query
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ALL_EXPENSES_CAP);

  const rows = data ?? [];
  const names = await resolveUserNames(
    admin,
    rows.flatMap((r) => [r.submitted_by, r.reimburse_to_user_id].filter((v): v is string => !!v)),
  );

  return rows.map((r) => {
    const category = one(r.category as OneOrArray<{ label_th: string }>);
    const project = one(r.project as OneOrArray<{ name: string }>);
    const card = one(r.card as OneOrArray<{ label: string }>);
    return {
      id: r.id,
      description: r.description,
      amount: r.amount,
      expenseDate: r.expense_date,
      paymentSource: r.payment_source,
      categoryLabel: category?.label_th ?? null,
      projectName: project?.name ?? null,
      cardLabel: card?.label ?? null,
      reimburseToName: r.reimburse_to_user_id ? (names.get(r.reimburse_to_user_id) ?? null) : null,
      reimbursedAt: r.reimbursed_at,
      submitterId: r.submitted_by,
      submitterName: names.get(r.submitted_by) ?? null,
    };
  });
}

// Spec 373 D3 — the firm-wide summary for the finance scope. Same shape as the
// personal one so <ExpenseSummary> renders either; bySource is the card-
// statement reconciliation line. ⚠️ The pending figure is NEVER month-scoped —
// debt has no month — and payment source is orthogonal to reimbursement state.
export interface AllExpenseSummary extends MyExpenseSummary {
  bySource: SourceSpend[];
}

export async function loadAllExpenseSummary(
  supabase: DB,
  { projectId, monthStart, monthEndExclusive }: AllExpenseFilters,
): Promise<AllExpenseSummary> {
  let spendQuery = supabase
    .from("office_expenses")
    .select(
      "amount, payment_source, category:office_expense_categories!office_expenses_category_id_fkey(label_th)",
    );
  if (projectId) spendQuery = spendQuery.eq("project_id", projectId);
  if (monthStart) spendQuery = spendQuery.gte("expense_date", monthStart);
  if (monthEndExclusive) spendQuery = spendQuery.lt("expense_date", monthEndExclusive);

  let pendQuery = supabase
    .from("office_expenses")
    .select("amount")
    .not("reimburse_to_user_id", "is", null)
    .is("reimbursed_at", null);
  if (projectId) pendQuery = pendQuery.eq("project_id", projectId);

  const [spendRes, pendRes] = await Promise.all([spendQuery, pendQuery]);

  const spendRows = (spendRes.data ?? []).map((r) => ({
    label: one(r.category as OneOrArray<{ label_th: string }>)?.label_th ?? null,
    amount: r.amount,
    paymentSource: r.payment_source,
  }));

  return {
    monthLabel: monthStart ? monthStart.slice(0, 7) : "all",
    monthTotal: sumAmounts(spendRows),
    pendingReimburse: sumAmounts((pendRes.data ?? []).map((r) => ({ amount: r.amount }))),
    byCategory: aggregateCategorySpend(spendRows),
    bySource: aggregateSourceSpend(spendRows),
  };
}

// Expenses awaiting reimbursement (target set, not yet reimbursed). RLS restricts
// rows to finance (accounting/super_admin) — the /expenses page gates the queue to
// OFFICE_EXPENSE_FINANCE_ROLES, and a submitter only ever sees their own here.
// Spec 323 U4: the project lens narrows the queue the same way as the own list.
export async function listReimbursableExpenses(
  supabase: DB,
  projectId?: string,
): Promise<ReimbursableRow[]> {
  let query = supabase
    .from("office_expenses")
    .select(
      "id, amount, expense_date, description, reimburse_to_user_id, category:office_expense_categories!office_expenses_category_id_fkey(label_th), reimburse:users!office_expenses_reimburse_to_user_id_fkey(full_name)",
    )
    .not("reimburse_to_user_id", "is", null)
    .is("reimbursed_at", null);
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query.order("expense_date", { ascending: true });

  return (data ?? []).map((r) => {
    const category = one(r.category as OneOrArray<{ label_th: string }>);
    const reimburse = one(r.reimburse as OneOrArray<{ full_name: string | null }>);
    return {
      id: r.id,
      reimburseToUserId: r.reimburse_to_user_id as string,
      reimburseToName: reimburse?.full_name ?? null,
      amount: r.amount,
      categoryLabel: category?.label_th ?? null,
      expenseDate: r.expense_date,
      description: r.description,
    };
  });
}

export interface MyExpenseSummary {
  monthLabel: string; // "YYYY-MM" (Asia/Bangkok)
  monthTotal: number;
  pendingReimburse: number;
  byCategory: CategorySpend[];
}

// The caller's personal dashboard: this (Bangkok) month's spend by category +
// the month total + the amount still owed back to them (pending reimbursement).
// Spec 323 U4: under an active project lens BOTH figures scope to that project,
// so the summary card never disagrees with the filtered list below it.
export async function loadMyExpenseSummary(
  supabase: DB,
  userId: string,
  projectId?: string,
): Promise<MyExpenseSummary> {
  const monthLabel = bangkokTodayIso().slice(0, 7); // YYYY-MM
  const monthStart = `${monthLabel}-01`;
  // Upper-bound the month so a future-dated expense can't leak into "this month".
  const [y, m] = monthLabel.split("-").map(Number) as [number, number];
  const nextMonthStart = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  let monthQuery = supabase
    .from("office_expenses")
    .select("amount, category:office_expense_categories!office_expenses_category_id_fkey(label_th)")
    .eq("submitted_by", userId)
    .gte("expense_date", monthStart)
    .lt("expense_date", nextMonthStart);
  let pendQuery = supabase
    .from("office_expenses")
    .select("amount")
    .eq("reimburse_to_user_id", userId)
    .is("reimbursed_at", null);
  if (projectId) {
    monthQuery = monthQuery.eq("project_id", projectId);
    pendQuery = pendQuery.eq("project_id", projectId);
  }
  const [monthRes, pendRes] = await Promise.all([monthQuery, pendQuery]);

  const monthRows = (monthRes.data ?? []).map((r) => ({
    label: one(r.category as OneOrArray<{ label_th: string }>)?.label_th ?? null,
    amount: r.amount,
  }));

  return {
    monthLabel,
    monthTotal: sumAmounts(monthRows),
    pendingReimburse: sumAmounts((pendRes.data ?? []).map((r) => ({ amount: r.amount }))),
    byCategory: aggregateCategorySpend(monthRows),
  };
}
