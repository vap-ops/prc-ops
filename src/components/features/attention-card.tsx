// AttentionCard (spec 54): the app's single callout pattern — white card,
// thick coloured left bar, a dot, a bold imperative title. amber = action
// needed, red = rejected/blocking. The action itself renders as children.
// Field-First: token-rewired; surface on the card tokens.

interface AttentionCardProps {
  tone: "amber" | "red";
  title: string;
  children: React.ReactNode;
}

const TONE = {
  amber: { bar: "border-l-attn", dot: "bg-attn", ground: "bg-attn-soft border-attn-edge" },
  red: { bar: "border-l-danger", dot: "bg-danger", ground: "bg-danger-soft border-danger-edge" },
} as const;

export function AttentionCard({ tone, title, children }: AttentionCardProps) {
  const t = TONE[tone];
  return (
    <div
      role="alert"
      className={`rounded-card border border-l-[5px] ${t.ground} ${t.bar} shadow-card px-4 py-3`}
    >
      <p className="text-body text-ink flex items-center gap-2 font-bold">
        <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${t.dot}`} />
        {title}
      </p>
      <div className="text-body text-ink-secondary mt-1.5">{children}</div>
    </div>
  );
}
