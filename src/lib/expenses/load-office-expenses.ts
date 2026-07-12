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
