// CountChip (spec 54): a tappable counter for items needing attention
// ("2 คำขอซื้อรออนุมัติ ›"). Renders nothing at zero. Server-presentational.
// Field-First: token-rewired onto the attention palette; 44px floor kept.

import Link from "next/link";

interface CountChipProps {
  count: number;
  label: string;
  href: string;
}

export function CountChip({ count, label, href }: CountChipProps) {
  if (count === 0) return null;
  return (
    <Link
      href={href}
      className="border-attn-edge bg-attn-soft text-body text-attn-ink shadow-input focus-visible:ring-action inline-flex min-h-11 w-fit items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-2 font-semibold transition-[filter] hover:brightness-95 focus:outline-none focus-visible:ring-2"
    >
      <span className="bg-attn-press text-meta text-on-fill inline-flex h-7 w-7 items-center justify-center rounded-full font-bold">
        {count}
      </span>
      {label}
      <span aria-hidden="true" className="text-attn-press">
        ›
      </span>
    </Link>
  );
}
