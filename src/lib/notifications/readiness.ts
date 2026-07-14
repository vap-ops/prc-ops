// Spec 318 U2 — per-user notification readiness (server-only reader).
// Reads the caller's OWN users row (read-self RLS): LINE identity is minted
// at login, OA friendship comes from the U1 login-time probe, Telegram is
// the optional operator-set second channel. Best-effort: any failure → null
// (callers render nothing — readiness surfaces must never break a page).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

/** Public add-friend link for the OA @070vkizw (notification push channel). */
export const OA_ADD_FRIEND_URL = "https://line.me/R/ti/p/@070vkizw";

export interface NotificationReadiness {
  /** LINE identity minted (always true for LINE-login users). */
  lineLinked: boolean;
  /** OA friendship at last login probe; null = never probed (pre-318 login). */
  friendFlag: boolean | null;
  checkedAt: string | null;
  /** Optional second channel (operator-set telegram_chat_id). */
  telegramLinked: boolean;
}

export interface ReadinessUserRow {
  line_user_id: string | null;
  line_oa_friend: boolean | null;
  line_oa_friend_checked_at: string | null;
  telegram_chat_id: string | null;
}

/** Pure builder — pages that already SELECT their own users row use this
 *  instead of loadNotificationReadiness to avoid a duplicate round-trip. */
export function readinessFromUserRow(row: ReadinessUserRow): NotificationReadiness {
  return {
    lineLinked: row.line_user_id !== null,
    friendFlag: row.line_oa_friend,
    checkedAt: row.line_oa_friend_checked_at,
    telegramLinked: row.telegram_chat_id !== null,
  };
}

export async function loadNotificationReadiness(
  supabase: SupabaseClient<Database>,
): Promise<NotificationReadiness | null> {
  try {
    const { data } = await supabase.auth.getClaims();
    if (!data) return null;
    const { data: row } = await supabase
      .from("users")
      .select("line_user_id, line_oa_friend, line_oa_friend_checked_at, telegram_chat_id")
      .eq("id", data.claims.sub)
      .maybeSingle();
    if (!row) return null;
    return readinessFromUserRow(row);
  } catch {
    return null;
  }
}
