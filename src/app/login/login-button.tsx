// Plain server-rendered anchor to /auth/line/start per ADR 0012.
// No client-side Supabase call — the OAuth flow is server-only.
// A plain <a> (not next/link) so prefetching cannot accidentally
// trigger the OAuth state-cookie set on hover.

export function LoginButton() {
  return (
    <a
      href="/auth/line/start"
      className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-6 py-3 text-base font-medium text-zinc-950 transition-colors hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
    >
      เข้าสู่ระบบด้วย LINE
    </a>
  );
}
