// Shared server-action auth gate (spec 65). Replaces the getUser +
// not-signed-in block that was copy-pasted at the top of every server
// action. Callers keep their own return shapes and (where they differ)
// their own error strings — this helper only owns the fetch-and-check.

import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/db/server";

/** The canonical Thai "not signed in" action error. */
export const NOT_SIGNED_IN = "ยังไม่ได้เข้าสู่ระบบ";

export interface ActionAuth {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
}

/**
 * RLS-scoped client + session user for a server action, or null when the
 * caller is not signed in (auth error or no user — both null).
 */
export async function getActionUser(): Promise<ActionAuth | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user };
}
