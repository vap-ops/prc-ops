"use client";

import type { Provider } from "@supabase/supabase-js";
import { useState } from "react";
import { createClient } from "@/lib/db/browser";
import { env } from "@/lib/env";

// supabase-js v2's `Provider` union does not list `custom:*` entries even though
// the JSDoc on `Provider` documents the `custom:` prefix for custom OIDC
// providers. Narrow through `unknown` (per CLAUDE.md: never widen with `any`).
const LINE_PROVIDER = "custom:line" as unknown as Provider;

export function LoginButton() {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: LINE_PROVIDER,
      options: {
        redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
    if (error) {
      setPending(false);
      window.location.assign("/login?error=oauth_failed");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-6 py-3 text-base font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Redirecting…" : "Log in with LINE"}
    </button>
  );
}
