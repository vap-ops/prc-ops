"use client";

// Spec 339 U1 — "is THIS device running the current build?", answered honestly.
//
// 'use client' is the whole point of this component, not an accident: the two
// versions it compares come from different places on purpose.
//   - `deployed` is a server prop (`pkg.version` on /settings). Server output is
//     re-rendered on every request, so a stranded client still receives the
//     CURRENT number — which is exactly why a server-rendered version row can
//     never prove the client is fresh. Read alone it is actively misleading: it
//     already says the new number before the user restarts anything.
//   - `NEXT_PUBLIC_APP_VERSION` is inlined into the CLIENT bundle at build time
//     (next.config.ts). A PWA resumed from background is still executing its old
//     bundle, so this constant is the old build's — the one fact on the page that
//     actually goes stale, and therefore the only one worth comparing.
// Reading it inside an effect (not during render) keeps the server and client
// passes identical, so a stale bundle surfaces as a state update rather than a
// hydration mismatch.
//
// The var is optional (`env.ts`) — unset in dev/test — so "unknown" is a real
// state and must not be reported as either fresh or stale.

import { useSyncExternalStore } from "react";

import { clientEnv } from "@/lib/env";

// Vercel builds append a short commit SHA (`0.173.0+7f3a1c2`); `deployed` never
// carries one, so compare the semver part.
function baseVersion(v: string): string {
  return v.split("+")[0] ?? v;
}

// useSyncExternalStore, not an effect: it is the sanctioned way to render one
// value on the server and another on the client without a hydration mismatch —
// and the lint rule (react-hooks/set-state-in-effect) rightly bans the setState
// form. The "store" never changes; only WHICH snapshot runs matters.
// Read through the client-env SSOT (env.ts), the same path telemetry's
// readAppVersion uses — never raw process.env (CLAUDE.md).
const subscribe = () => () => {};
// `|| null`, not `?? null`: an empty inlined value is as unknown as a missing
// one, and treating "" as a version would render a false "this device is stale".
const clientVersion = () => clientEnv.NEXT_PUBLIC_APP_VERSION || null;
const serverVersion = () => null;

export function AppVersionCheck({ deployed }: { deployed: string }) {
  const loaded = useSyncExternalStore(subscribe, clientVersion, serverVersion);

  if (loaded === null) {
    return (
      <p className="bg-sunk text-ink-secondary rounded-control text-meta px-3 py-2 leading-relaxed">
        เวอร์ชันล่าสุดคือ <span className="font-mono font-semibold">{deployed}</span> —
        ถ้ามีฟีเจอร์ใหม่แล้วยังไม่เห็น ให้ปิดแอปสนิทตามขั้นตอนด้านบน
      </p>
    );
  }

  return baseVersion(loaded) !== deployed ? (
    <p className="bg-attn-soft text-attn-ink rounded-control text-meta px-3 py-2 leading-relaxed">
      เครื่องนี้ยังใช้เวอร์ชัน{" "}
      <span className="font-mono font-semibold">{baseVersion(loaded)}</span> แต่ล่าสุดคือ{" "}
      <span className="font-mono font-semibold">{deployed}</span> — ปิดแอปสนิทตามขั้นตอนด้านบน
      แล้วกลับมาดูบรรทัดนี้อีกครั้ง
    </p>
  ) : (
    <p className="bg-done-soft text-done-ink rounded-control text-meta px-3 py-2 leading-relaxed">
      เครื่องนี้ใช้เวอร์ชันล่าสุดแล้ว <span className="font-mono font-semibold">{deployed}</span>
    </p>
  );
}
