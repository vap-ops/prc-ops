// Browser flow: plain server-rendered anchor to /auth/line/start per
// ADR 0012 — a plain <a> (not next/link) so prefetching cannot
// accidentally trigger the OAuth state-cookie set on hover.
//
// Standalone (installed PWA) flow: the device-code handoff control
// (spec 43 / ADR 0041), CSS-toggled by the display-mode media query so
// the server renders both and the client runs none of it in a browser
// tab.

import { StandaloneLoginButton } from "./standalone-login-button";

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
      <div className="hidden [@media(display-mode:standalone)]:block">
        <StandaloneLoginButton className={`inline-flex ${BUTTON_CLASSES}`} />
      </div>
    </>
  );
}
