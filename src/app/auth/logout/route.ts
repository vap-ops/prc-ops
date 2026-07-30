import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db/server";
import { clearAssumedRoleCookie } from "@/lib/auth/assumed-role.server";
import { safeNextPath } from "@/lib/auth/next-path";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Spec 274 — drop any super_admin "view as" so it can't survive sign-out onto
  // the next (or a shared/kiosk) session. Idempotent for everyone else.
  await clearAssumedRoleCookie();
  const url = request.nextUrl.clone();
  // Spec 376 U4 — an OPTIONAL return path, for the shared-phone register
  // interstitial: sign the borrowed session out and land the real applicant back
  // on the SAME register door with its mint-once QR params. `next` arrives as a
  // query param (attacker-influenceable → open-redirect vector), so it is
  // re-validated HERE, at the point of consumption; anything safeNextPath
  // rejects falls back to the historical "/" landing. Resolved against the
  // origin rather than assigned to `url.pathname`, which would percent-encode
  // the "?" (same handling as the LINE callback's next).
  const next = safeNextPath(url.searchParams.get("next"));
  if (next) return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}

export function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
