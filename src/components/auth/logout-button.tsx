export function LogoutButton({
  label = "ออกจากระบบ",
  variant = "light",
  next,
}: {
  label?: string;
  /** "dark" sits on the spec-38 slate brand band (AppHeader). */
  variant?: "light" | "dark";
  /** Spec 376 U4 — where to land AFTER sign-out, instead of "/". A same-origin
   * path (query included) for the one flow that must return to where it stood:
   * the shared-phone register interstitial sends the borrowed session out and
   * the real applicant back to the SAME register door, QR params intact. The
   * route re-validates it with safeNextPath — passing a value here never
   * bypasses that guard. */
  next?: string;
}) {
  const className =
    variant === "dark"
      ? "inline-flex min-h-11 items-center justify-center rounded-control border border-edge-strong bg-brand-2 px-4 py-2 text-sm font-medium text-on-fill transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-attn"
      : "inline-flex min-h-11 items-center justify-center rounded-control border border-edge-strong bg-card px-4 py-2 text-sm font-medium text-ink shadow-xs transition-colors hover:bg-page focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
  const action = next ? `/auth/logout?next=${encodeURIComponent(next)}` : "/auth/logout";
  return (
    <form method="post" action={action}>
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
