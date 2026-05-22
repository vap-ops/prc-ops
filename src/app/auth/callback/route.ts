import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/db/server";
import { createClient as createAdminSupabaseClient } from "@/lib/db/admin";

const LINE_PROVIDER = "custom:line";
const PROFILE_READ_RETRY_DELAY_MS = 50;
const PROFILE_READ_MAX_ATTEMPTS = 3;

function redirectToLogin(request: NextRequest, error: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

function redirectByRole(request: NextRequest, role: string) {
  const url = request.nextUrl.clone();
  url.search = "";
  if (role === "site_admin") {
    url.pathname = "/sa";
  } else if (role === "project_manager") {
    url.pathname = "/pm";
  } else {
    url.pathname = "/coming-soon";
  }
  return NextResponse.redirect(url);
}

function extractClaim(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractLineClaims(user: User): { sub: string | null; name: string | null } {
  const identity = user.identities?.find((i) => i.provider === LINE_PROVIDER);
  const identityData: Record<string, unknown> = identity?.identity_data ?? {};
  const metadata: Record<string, unknown> = user.user_metadata ?? {};
  return {
    sub: extractClaim(identityData.sub) ?? extractClaim(metadata.sub),
    name: extractClaim(identityData.name) ?? extractClaim(metadata.name),
  };
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError || !code) {
    return redirectToLogin(request, "oauth_failed");
  }

  const supabase = await createServerSupabaseClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return redirectToLogin(request, "session_failed");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectToLogin(request, "session_failed");
  }

  let row: {
    role: string;
    line_user_id: string | null;
    full_name: string | null;
  } | null = null;
  for (let attempt = 0; attempt < PROFILE_READ_MAX_ATTEMPTS; attempt++) {
    const { data } = await supabase
      .from("users")
      .select("role, line_user_id, full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      row = data;
      break;
    }
    if (attempt < PROFILE_READ_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PROFILE_READ_RETRY_DELAY_MS));
    }
  }

  if (!row) {
    console.error("[auth/callback] users row missing after retries", {
      userId: user.id,
    });
    return redirectToLogin(request, "unknown");
  }

  const claims = extractLineClaims(user);
  const updates: { line_user_id?: string; full_name?: string } = {};
  if (row.line_user_id === null && claims.sub) updates.line_user_id = claims.sub;
  if (row.full_name === null && claims.name) updates.full_name = claims.name;

  if (Object.keys(updates).length > 0) {
    const admin = createAdminSupabaseClient();
    const { error: updateError } = await admin.from("users").update(updates).eq("id", user.id);
    if (updateError) {
      console.error("[auth/callback] profile update failed", {
        userId: user.id,
        error: updateError.message,
      });
      // Profile-write failure is not fatal — the user is signed in, just continue.
    }
  }

  return redirectByRole(request, row.role);
}
