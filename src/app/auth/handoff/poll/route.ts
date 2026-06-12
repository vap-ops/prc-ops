// Spec 43 / ADR 0041 — device-code handoff, step 3 of 3 (collector).
//
// The standalone PWA polls with its device_code. An approved row is
// claimed atomically (status approved → consumed; the claim-loser of a
// concurrent poll gets "expired"), then the session is minted onto THIS
// response via the ADR 0012 generateLink → verifyOtp pair — the sb-*
// cookies land in the PWA's own jar, which is the whole point. The
// ADR 0012 profile write (NULL-only line_user_id/full_name, avatar
// refresh) runs here from the claims the callback stashed on the row.
//
// Every non-claimable outcome answers {status:"expired"} — a probing
// client learns nothing from a wrong device_code. A mint failure after
// the claim burns the handoff (recorded ADR 0041 trade-off): the user
// simply taps login again.

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { roleHome } from "@/lib/auth/role-home";

type PollBody = { device_code?: unknown };
type LineClaimsStash = { sub?: unknown; name?: unknown; picture?: unknown };

function json(status: "pending" | "expired"): NextResponse {
  return NextResponse.json({ status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let deviceCode: string;
  try {
    const body = (await request.json()) as PollBody;
    if (typeof body.device_code !== "string" || body.device_code.length === 0) {
      return json("expired");
    }
    deviceCode = body.device_code;
  } catch {
    return json("expired");
  }

  const admin = createAdminSupabase();
  const { data: row } = await admin
    .from("login_handoffs")
    .select("id, status, user_email, line_claims, expires_at")
    .eq("device_code", deviceCode)
    .maybeSingle();

  if (!row || Date.parse(row.expires_at) <= Date.now()) return json("expired");
  if (row.status === "pending") return NextResponse.json({ status: "pending" });
  if (row.status !== "approved" || !row.user_email) return json("expired");

  // ---- Atomic claim: single use, before any minting ----
  const { data: claimed } = await admin
    .from("login_handoffs")
    .update({ status: "consumed" })
    .eq("id", row.id)
    .eq("status", "approved")
    .select("id");
  if (!claimed || claimed.length === 0) return json("expired");

  // ---- Mint the session in THIS (PWA) context — ADR 0012 mechanism ----
  const linkResult = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: row.user_email,
  });
  if (linkResult.error || !linkResult.data.properties?.hashed_token) {
    console.error("[auth/handoff/poll] generateLink failed", {
      code: linkResult.error?.code,
      message: linkResult.error?.message,
    });
    return json("expired");
  }

  const supabase = await createServerSupabase();
  const verifyResult = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkResult.data.properties.hashed_token,
  });
  if (verifyResult.error || !verifyResult.data.user) {
    console.error("[auth/handoff/poll] verifyOtp failed", {
      message: verifyResult.error?.message,
    });
    return json("expired");
  }
  const user = verifyResult.data.user;

  // ---- Role read + profile write (browser-callback parity) ----
  const { data: profile } = await supabase
    .from("users")
    .select("role, line_user_id, full_name, line_avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const claims = (row.line_claims ?? {}) as LineClaimsStash;
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const name = typeof claims.name === "string" ? claims.name : null;
  const picture = typeof claims.picture === "string" ? claims.picture : null;
  if (profile) {
    const updates: {
      line_user_id?: string;
      full_name?: string;
      line_avatar_url?: string | null;
    } = {};
    if (profile.line_user_id === null && sub) updates.line_user_id = sub;
    if (profile.full_name === null && name) updates.full_name = name;
    if (picture !== profile.line_avatar_url) updates.line_avatar_url = picture;
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin.from("users").update(updates).eq("id", user.id);
      if (updateError) {
        console.error("[auth/handoff/poll] profile update failed", {
          userId: user.id,
          message: updateError.message,
        });
        // Non-fatal — the session is minted; continue.
      }
    }
  }

  const redirect = profile ? roleHome(profile.role) : "/coming-soon";
  return NextResponse.json({ status: "ok", redirect });
}
