// Spec 299 U1 — one help card: a native <details> accordion (zero-JS server component)
// titled by the task, expanding to a "เมื่อไหร่ใช้" line + numbered steps + an optional
// tip. The <details> carries the card's anchor id so a future per-screen "?" can
// deep-link (/sa/help#photos). Content is passed as data (HelpCard).

import type { HelpCard as HelpCardData } from "@/lib/sa/help-content";

export function HelpCard({ card }: { card: HelpCardData }) {
  return (
    <details id={card.id} className="rounded-card border-edge bg-card shadow-card border px-4 py-3">
      <summary className="text-ink text-body cursor-pointer font-semibold">{card.title}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-ink-secondary text-sm">
          <span className="text-ink-muted">เมื่อไหร่ใช้ · </span>
          {card.whenToUse}
        </p>
        <ol className="text-ink flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          {card.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {card.tip ? <p className="text-ink-muted text-meta">💡 {card.tip}</p> : null}
      </div>
    </details>
  );
}
