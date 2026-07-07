import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db/server";
import { clearAssumedRoleCookie } from "@/lib/auth/assumed-role.server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Spec 274 — drop any super_admin "view as" so it can't survive sign-out onto
  // the next (or a shared/kiosk) session. Idempotent for everyone else.
  await clearAssumedRoleCookie();
  const url = request.nextUrl.clone();
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
