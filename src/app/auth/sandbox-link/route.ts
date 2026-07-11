// Spec 294 U2 — one-click login for the SANDBOX tenant only.
//
// The sandbox has no LINE callback registration (no wildcard support), so
// designer/tester logins are minted server-side: admin generateLink produces a
// hashed_token, and a link to this route carries it. verifyOtp on the SSR
// client writes the sb-* cookies onto the redirect response — the same mint
// mechanics as the LINE callback's step 4 (ADR 0012).
//
// PROD-INERT BY CONSTRUCTION: unless the deployment sets
// NEXT_PUBLIC_APP_ENV=sandbox (only the sandbox Vercel project does), this
// route 404s before touching auth. The token itself is one-time + short-lived.

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { clientEnv } from "@/lib/env";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (clientEnv.NEXT_PUBLIC_APP_ENV !== "sandbox") {
    return new NextResponse(null, { status: 404 });
  }

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!tokenHash) {
    return new NextResponse("token_hash required", { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error) {
    // Expired/used link — land on the normal login page rather than an error blob.
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Root redirects by role (roleHome) for the freshly minted session.
  return NextResponse.redirect(new URL("/", request.url));
}
