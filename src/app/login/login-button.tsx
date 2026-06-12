// Plain server-rendered anchor to /auth/line/start per ADR 0012.
// No client-side Supabase call — the OAuth flow is server-only.
// A plain <a> (not next/link) so prefetching cannot accidentally
// trigger the OAuth state-cookie set on hover.
//
// Spec 42: two anchors toggled by the display-mode media query. The
// installed PWA (standalone) starts the flow with ?standalone=1 so the
// start route can keep LINE's login inside the PWA's browsing context
// (disable_auto_login on iOS). CSS-only — stays a Server Component.

const BUTTON_CLASSES =
  "w-full items-center justify-center rounded-md bg-emerald-500 px-6 py-3 text-base font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300";

export function LoginButton() {
  return (
    <>
      <a
        href="/auth/line/start"
        className={`inline-flex [@media(display-mode:standalone)]:hidden ${BUTTON_CLASSES}`}
      >
        เข้าสู่ระบบด้วย LINE
      </a>
      <a
        href="/auth/line/start?standalone=1"
        className={`hidden [@media(display-mode:standalone)]:inline-flex ${BUTTON_CLASSES}`}
      >
        เข้าสู่ระบบด้วย LINE
      </a>
    </>
  );
}
