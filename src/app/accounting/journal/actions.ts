"use server";

// Spec G8 — manual general-journal write actions over the existing SECURITY
// DEFINER RPCs (post_journal_entry / reverse_journal_entry). They gate the
// AUTHENTICATED session's role (PM_ROLES = pm/super/project_director, exactly who
// the RPCs admit — verified live), so we call them on requireActionRole().auth.
// .supabase, never the admin client (service-role's null role the gate refuses).
// validateJournalLines is the same pure double-entry gate the post_journal_internal
// RPC re-asserts server-side; this is the friendly early check + defense-in-depth.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import { validateJournalLines, type JournalLineInput } from "@/lib/accounting/journal";
import {
  ACCOUNTING_ACTION_ERROR as GENERIC,
  type AccountingActionResult,
} from "@/lib/accounting/billing-actions";

export interface PostManualJournalInput {
  entryDate: string;
  memo?: string | null;
  lines: JournalLineInput[];
}

export async function postManualJournal(
  input: PostManualJournalInput,
): Promise<AccountingActionResult> {
  const g = await requireActionRole(PM_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };

  if (!input.entryDate) return { ok: false, error: "กรุณาระบุวันที่" };
  // Same pure gate the RPC re-asserts — reject an unbalanced/one-sided entry early.
  const check = validateJournalLines(input.lines);
  if (!check.ok) return { ok: false, error: check.error };

  const { error } = await g.auth.supabase.rpc("post_journal_entry", {
    p_entry_date: input.entryDate,
    // p_memo is a required string in the generated types; the RPC normalizes an
    // empty/blank memo to NULL (nullif(btrim(coalesce(...)))).
    p_memo: input.memo ?? "",
    p_lines: input.lines.map((l) => ({
      account_code: l.accountCode,
      debit: l.debit,
      credit: l.credit,
    })),
  });
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting");
  return { ok: true };
}

export async function reverseManualJournal(input: {
  entryId: string;
  memo?: string | null;
}): Promise<AccountingActionResult> {
  const g = await requireActionRole(PM_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };

  // exactOptionalPropertyTypes: omit p_memo entirely (SQL default applies) rather
  // than passing undefined.
  const args: { p_entry_id: string; p_memo?: string } = { p_entry_id: input.entryId };
  if (input.memo) args.p_memo = input.memo;

  const { error } = await g.auth.supabase.rpc("reverse_journal_entry", args);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting");
  return { ok: true };
}
