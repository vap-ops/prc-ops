import Link from "next/link";

// Shared hub nav strip (spec 18). One consistent item set per role
// surface — the PM pages all show the same four destinations, /sa shows
// two — with the current page rendered as a non-link span. Tab
// semantics: no directional arrows; min-h-11 tap targets for gloved
// site hands. NOT used by /requests (its back-bar is spec-12 locked
// behavior), the reports page (project-detail back-nav), or detail
// screens.

export interface HubNavItem {
  label: string;
  href: string;
}

// The canonical item sets — every consuming page passes one of these so
// the destinations and their order never drift between pages again.
export const PM_HUB_NAV: ReadonlyArray<HubNavItem> = [
  { label: "รายการรอตรวจ", href: "/pm" },
  { label: "โครงการและรายงาน", href: "/pm/projects" },
  { label: "คำขอซื้อ", href: "/pm/requests" },
  { label: "คำขอซื้อของฉัน", href: "/requests" },
];

export const SA_HUB_NAV: ReadonlyArray<HubNavItem> = [
  { label: "โครงการ", href: "/sa" },
  { label: "คำขอซื้อของฉัน", href: "/requests" },
];

interface HubNavProps {
  maxWidthClass: "max-w-2xl" | "max-w-3xl";
  items: ReadonlyArray<HubNavItem>;
  currentHref: string;
}

export function HubNav({ maxWidthClass, items, currentHref }: HubNavProps) {
  return (
    <nav className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-1">
      <div className={`mx-auto flex ${maxWidthClass} flex-wrap items-center gap-x-4 text-xs`}>
        {items.map((item) =>
          item.href === currentHref ? (
            <span key={item.href} className="inline-flex min-h-11 items-center text-zinc-100">
              {item.label}
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
