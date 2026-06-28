import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/auth/line/start",
  "/auth/line/callback",
  // Spec 43 — device-code handoff (unauthenticated by definition).
  "/auth/handoff/start",
  "/auth/handoff/poll",
]);

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Verify + refresh the session. getClaims() verifies the JWT LOCALLY against
  // the cached JWKS — the project is on asymmetric signing keys (ADR 0021), so
  // there is no GoTrue round-trip on the hot path, unlike getUser() which called
  // the Auth server on EVERY navigation. Refresh is preserved: getClaims() reads
  // the session via getSession(), which auto-refreshes an expired access token
  // (auth-js _callRefreshToken), and the @supabase/ssr cookie adapter (setAll
  // above) persists the rotated tokens onto supabaseResponse. data is null when
  // there is no/invalid session (mirrors the render-path gate in require-role.ts).
  // Do not insert code between createServerClient and getClaims: anything that
  // runs in between can desync cookies and randomly sign users out.
  const { data } = await supabase.auth.getClaims();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.has(pathname);
  if (!data && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
