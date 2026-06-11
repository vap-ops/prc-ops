export function LogoutButton({
  label = "ออกจากระบบ",
  variant = "light",
}: {
  label?: string;
  /** "dark" sits on the spec-38 slate brand band (AppHeader). */
  variant?: "light" | "dark";
}) {
  const className =
    variant === "dark"
      ? "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      : "inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-xs transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";
  return (
    <form method="post" action="/auth/logout">
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
