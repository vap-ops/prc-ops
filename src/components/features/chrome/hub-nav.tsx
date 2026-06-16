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
// Spec 93: desktop mirrors the bottom bar — daily deciders + a ตั้งค่า entry.
// ค่าจ้าง (payroll) and รายชื่อติดต่อ (contacts) + ทีมงาน (workers) moved into
// the /settings hub, so the strip stays the primary-decision destinations.
export const PM_HUB_NAV: ReadonlyArray<HubNavItem> = [
  // Spec 82 Unit 4: the review queue is the content-named /review (was /pm).
  { label: "รายการรอตรวจ", href: "/review" },
  // Spec 82 Unit 3: the project hub folded to the content-named /projects.
  { label: "โครงการและรายงาน", href: "/projects" },
  { label: "คำขอซื้อ", href: "/requests" },
  // Spec 100: ภาพรวม is the live role-aware dashboard.
  { label: "ภาพรวม", href: "/dashboard" },
  { label: "ตั้งค่า", href: "/settings" },
];

export const SA_HUB_NAV: ReadonlyArray<HubNavItem> = [
  // Spec 82 Unit 3: the SA project hub folded to the shared /projects hub.
  { label: "โครงการ", href: "/projects" },
  { label: "คำขอซื้อ", href: "/requests" },
  // Spec 100: ภาพรวม is the live role-aware dashboard.
  { label: "ภาพรวม", href: "/dashboard" },
  { label: "ตั้งค่า", href: "/settings" },
];

// Spec 101: procurement's desktop strip — its worklist + the suppliers master
// + settings. No project/review/dashboard surfaces (those stay PM/SA).
export const PROCUREMENT_HUB_NAV: ReadonlyArray<HubNavItem> = [
  { label: "คำขอซื้อ", href: "/requests" },
  // Spec 102: read-only project browse.
  { label: "โครงการ", href: "/projects" },
  { label: "ผู้ขาย", href: "/contacts/vendors" },
  { label: "ตั้งค่า", href: "/settings" },
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
    <nav className="border-edge bg-sunk hidden border-b px-5 py-1 sm:block">
      <div className={`mx-auto flex ${maxWidthClass} flex-wrap items-center gap-x-6 text-sm`}>
        {items.map((item) =>
          item.href === currentHref ? (
            <span
              key={item.href}
              className="border-action text-ink inline-flex min-h-11 items-center border-b-2 font-semibold"
            >
              {item.label}
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              className="text-ink-secondary hover:text-ink inline-flex min-h-11 items-center border-b-2 border-transparent transition-colors focus:outline-none focus-visible:underline"
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
