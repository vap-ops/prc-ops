// Spec 294 U2+U4 — login for the SANDBOX tenant only.
//
// PROD-INERT BY CONSTRUCTION: unless the deployment sets
// NEXT_PUBLIC_APP_ENV=sandbox (only the sandbox Vercel project does), every
// path here 404s before touching auth.
//
// Two ways in:
//   • U2 token path — GET ?token_hash=<hashed_token> verifies a one-time
//     magiclink token minted out-of-band (`pnpm`/CLI). Convenient but the token
//     is consumed by the FIRST fetch, so a chat-app link-preview crawler burns
//     it before the human clicks.
//   • U4 picker path (preview-safe, reusable) — a bare GET (or ?as=<persona>)
//     renders an HTML page that MINTS NOTHING; only the human's POST mints a
//     session server-side (admin generateLink → verifyOtp, the ADR 0012 pair).
//     So a forwarded link survives preview crawlers and is reusable forever.
//
// `as` is allowlisted to the seed personas (src/lib/sandbox/seed-data) — the
// route never mints for an arbitrary email. On the sandbox this is safe by
// design: the data is synthetic and anyone with the link is a tester.

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { clientEnv } from "@/lib/env";
import { SEED_PERSONAS } from "@/lib/sandbox/seed-data";

const PERSONA_BY_KEY = new Map(SEED_PERSONAS.map((p) => [p.key, p]));

function isSandbox(): boolean {
  return clientEnv.NEXT_PUBLIC_APP_ENV === "sandbox";
}

function html(body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>เข้าสู่ระบบ (แซนด์บ็อกซ์)</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:24rem;margin:3rem auto;padding:0 1rem}` +
      `h1{font-size:1.1rem}form{margin:0}button{display:block;width:100%;margin:.4rem 0;padding:.7rem;` +
      `font-size:1rem;border:1px solid #ccc;border-radius:.5rem;background:#fff;cursor:pointer}` +
      `button:hover{background:#f4f4f4}.meta{color:#666;font-size:.85rem}</style>${body}`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function personaButton(key: string, label: string): string {
  return (
    `<form method="POST"><input type="hidden" name="as" value="${key}">` +
    `<button type="submit">${label}</button></form>`
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSandbox()) return new NextResponse(null, { status: 404 });

  const params = request.nextUrl.searchParams;

  // U2 token path (unchanged).
  const tokenHash = params.get("token_hash");
  if (tokenHash) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
    return NextResponse.redirect(new URL(error ? "/login" : "/", request.url));
  }

  // U4 single-persona confirm page.
  const asKey = params.get("as");
  if (asKey !== null) {
    const persona = PERSONA_BY_KEY.get(asKey);
    if (!persona) return new NextResponse("unknown persona", { status: 400 });
    return html(
      `<h1>เข้าสู่ระบบแซนด์บ็อกซ์</h1>` +
        `<p class="meta">${persona.fullName} · ${persona.role}</p>` +
        personaButton(persona.key, `เข้าสู่ระบบ (${persona.role})`),
    );
  }

  // U4 full role picker (the stable, forwardable link).
  const buttons = SEED_PERSONAS.map((p) => personaButton(p.key, `${p.fullName} · ${p.role}`)).join(
    "",
  );
  return html(
    `<h1>เข้าสู่ระบบแซนด์บ็อกซ์</h1>` +
      `<p class="meta">เลือกบทบาทเพื่อทดสอบ — ข้อมูลทดสอบทั้งหมด</p>${buttons}`,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSandbox()) return new NextResponse(null, { status: 404 });

  const form = await request.formData();
  const asKey = String(form.get("as") ?? "");
  const persona = PERSONA_BY_KEY.get(asKey);
  if (!persona) return new NextResponse("unknown persona", { status: 400 });

  // Mint a fresh one-time token server-side, then consume it in the same
  // request so the session cookies land on this response (ADR 0012 pair).
  const admin = createAdminSupabase();
  const linkResult = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: persona.email,
  });
  const hashedToken = linkResult.data?.properties?.hashed_token;
  if (linkResult.error || !hashedToken) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hashedToken });
  if (error) return NextResponse.redirect(new URL("/login", request.url), 303);

  // 303: turn the POST into a GET of the role home.
  return NextResponse.redirect(new URL("/", request.url), 303);
}
