// AttentionCard (spec 54): the mockup's callout — white rounded card
// with a thick colored left bar, a dot, and a bold imperative title.
// One attention pattern for the whole app: amber = action needed
// (assign a contractor, needs_revision), red = rejected/blocking.
// Server-presentational; the action itself renders as children.

interface AttentionCardProps {
  tone: "amber" | "red";
  title: string;
  children: React.ReactNode;
}

const TONE = {
  amber: { bar: "border-l-amber-600", dot: "bg-amber-600" },
  red: { bar: "border-l-red-600", dot: "bg-red-600" },
} as const;

export function AttentionCard({ tone, title, children }: AttentionCardProps) {
  const t = TONE[tone];
  return (
    <div
      role="alert"
      className={`rounded-xl border border-l-4 border-zinc-200 ${t.bar} bg-white px-4 py-3 shadow-sm`}
    >
      <p className="flex items-center gap-2 text-sm font-bold text-zinc-900">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
        {title}
      </p>
      <div className="mt-1.5 text-sm text-zinc-700">{children}</div>
    </div>
  );
}
