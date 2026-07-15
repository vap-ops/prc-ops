import "server-only";

// Spec 319 — the caller's own login(user_id)-keyed bank. get_own_user_bank is
// DEFINER, keyed on auth.uid(); user_bank is zero-grant like every bank table
// (ADR 0079), so this is the only own-row read path outside the admin client.
// Mirrors getOwnStaffBank.

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;

export async function getOwnUserBank(
  supabase: ServerClient,
): Promise<{ bankName: string; accountNumber: string; accountName: string } | null> {
  const { data } = await supabase.rpc("get_own_user_bank");
  const row = Array.isArray(data) ? data[0] : null;
  return row
    ? {
        bankName: row.bank_name,
        accountNumber: row.bank_account_number,
        accountName: row.bank_account_name,
      }
    : null;
}
