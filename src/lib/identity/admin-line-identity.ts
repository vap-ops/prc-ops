import "server-only";

// Spec 265 U2 — admin-client read of ONE applicant's LINE-identity fields for
// the approval surface (/registrations/[id]). The users RLS is "read self" +
// super_admin (ADR 0011), so a procurement_manager / project_director approver
// cannot read the applicant's `users` row on their own RLS session. This mirrors
// the doc signed-URL mint's exposure model (admin-registrations.ts): the
// row-level authorization the caller ALREADY passed (they may see this
// staff_registration) is the gate; the admin client only reads the three LINE
// identity fields of the ONE user_id tied to that registration — never a broad
// users list. Only LINE-owned identity leaves this module.
//
// Failure is non-fatal by contract: on error the fields come back null, so the
// LineIdentityBlock renders its "ยังไม่ได้ซิงค์" empty state rather than throwing
// (a login/approval must never be blocked by a profile read).

import { createClient as createAdminClient } from "@/lib/db/admin";
import type { LineIdentityInput } from "@/lib/identity/line-identity";

export async function getLineIdentityByUserId(userId: string): Promise<LineIdentityInput> {
  const empty: LineIdentityInput = {
    lineDisplayName: null,
    lineAvatarUrl: null,
    lineSyncedAt: null,
  };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("line_display_name, line_avatar_url, line_synced_at")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("getLineIdentityByUserId failed", error.message);
    return empty;
  }

  return {
    lineDisplayName: data.line_display_name,
    lineAvatarUrl: data.line_avatar_url,
    lineSyncedAt: data.line_synced_at,
  };
}
