// Spec 98 — shared "coming soon" pill. Presentational + token-only (a theme
// change stays in globals.css; no raw Tailwind palette per design-doctrine).
// No hooks, so it renders in both Server and Client components.

export function ComingSoonBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`bg-sunk text-meta text-ink-secondary inline-flex items-center rounded-full px-2 py-0.5 font-medium ${className}`}
    >
      เร็วๆนี้
    </span>
  );
}
