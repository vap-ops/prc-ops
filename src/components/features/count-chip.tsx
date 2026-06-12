// CountChip (spec 54): the mockup's amber "1 คำขอซื้อรออนุมัติ ›" pill —
// a tappable counter for items needing someone's attention. Renders
// nothing at zero (no empty chips). Server-presentational.

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
      className="inline-flex min-h-11 w-fit items-center gap-2.5 rounded-full border border-amber-300 bg-amber-50 py-1.5 pr-4 pl-2 text-sm font-semibold text-amber-900 shadow-xs transition-colors hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-white">
        {count}
      </span>
      {label}
      <span aria-hidden="true" className="text-amber-700">
        ›
      </span>
    </Link>
  );
}
