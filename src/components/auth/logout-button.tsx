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
      ? "inline-flex min-h-11 items-center justify-center rounded-control border border-edge-strong bg-brand-2 px-4 py-2 text-sm font-medium text-on-fill transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-attn"
      : "inline-flex min-h-11 items-center justify-center rounded-control border border-edge-strong bg-card px-4 py-2 text-sm font-medium text-ink shadow-xs transition-colors hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
  return (
    <form method="post" action="/auth/logout">
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
