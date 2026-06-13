import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

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
// Spec 19 §4 merged /pm/requests into /requests: one purchasing entry.
export const PM_HUB_NAV: ReadonlyArray<HubNavItem> = [
  { label: "รายการรอตรวจ", href: "/pm" },
  { label: "โครงการและรายงาน", href: "/pm/projects" },
  { label: "คำขอซื้อ", href: "/requests" },
  // Spec 69: PM-only DC payroll (money) — every PM surface is already
  // PM/super-gated, so listing it here leaks nothing to SA.
  { label: "ค่าจ้าง", href: "/pm/payroll" },
];

export const SA_HUB_NAV: ReadonlyArray<HubNavItem> = [
  { label: "โครงการ", href: "/sa" },
  { label: "คำขอซื้อ", href: "/requests" },
];

interface HubNavProps {
  maxWidthClass: typeof PAGE_MAX_W;
  items: ReadonlyArray<HubNavItem>;
  currentHref: string;
}

export function HubNav({ maxWidthClass, items, currentHref }: HubNavProps) {
  return (
    // Desktop-only (spec 19 §2): phones navigate via the bottom tab bar.
    // Spec 20: light strip; the current page carries a blue underline —
    // an identifiable "you are here", not just a brighter gray.
    <nav className="hidden border-b border-zinc-200 bg-zinc-100 px-5 py-1 sm:block">
      <div className={`mx-auto flex ${maxWidthClass} flex-wrap items-center gap-x-6 text-sm`}>
        {items.map((item) =>
          item.href === currentHref ? (
            <span
              key={item.href}
              className="inline-flex min-h-11 items-center border-b-2 border-blue-700 font-semibold text-zinc-900"
            >
              {item.label}
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center border-b-2 border-transparent text-zinc-600 transition-colors hover:text-zinc-900 focus:outline-none focus-visible:underline"
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
