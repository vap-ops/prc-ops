import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { isManagerRole } from "@/lib/auth/role-home";
import type { UserRole } from "@/lib/db/enums";

// Shared hub nav strip (spec 18). One consistent item set per role
// surface — the PM pages all show the same four destinations, /sa shows
// two — with the current page rendered as a non-link span. Tab
// semantics: no directional arrows; min-h-11 tap targets for gloved
// site hands. Renders on every primary-tab hub — /review, /projects,
// /requests, /settings, /dashboard (spec 153, via hubNavForRole) — but
// NOT the reports page (project-detail back-nav) or detail screens.
// /portal is the documented exception (its own header + logout).

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
  // Spec 172 Phase B: procurement curates subcontractors too.
  { label: "ผู้รับเหมาช่วง", href: "/contacts/subcontractors" },
  // Spec 172 Phase C: procurement onboards DC workers (incl. the pay rate).
  { label: "ทีมงาน", href: "/workers" },
  { label: "ตั้งค่า", href: "/settings" },
];

// Spec 143 U2 / ADR 0056: project_coordinator's desktop strip — the see-all
// project hub + settings. Mirrors COORDINATOR_TABS; no review/requests/dashboard
// (those surfaces don't admit it).
export const COORDINATOR_HUB_NAV: ReadonlyArray<HubNavItem> = [
  { label: "โครงการ", href: "/projects" },
  { label: "ตั้งค่า", href: "/settings" },
];

// Spec 153: accounting's desktop strip — the read-only ledger surface + settings.
// Mirrors ACCOUNTING_TABS (spec 149 U9, the phone bottom bar); a lean two-set,
// every entry a live destination.
export const ACCOUNTING_HUB_NAV: ReadonlyArray<HubNavItem> = [
  { label: "บัญชี", href: "/accounting" },
  { label: "ตั้งค่า", href: "/settings" },
];

// Spec 153: the single role→strip selector — mirrors bottom-tab-bar's tabsForRole
// exactly, so the SAME strip renders on every hub page (incl. /settings +
// /dashboard, which previously rendered none). An unserved role gets null and the
// page renders no strip, exactly like the bottom bar.
export function hubNavForRole(role: string): ReadonlyArray<HubNavItem> | null {
  if (role === "site_admin") return SA_HUB_NAV;
  // Spec 152 / ADR 0058: project_director shares the PM strip (see-all PM).
  if (isManagerRole(role as UserRole)) return PM_HUB_NAV;
  if (role === "procurement") return PROCUREMENT_HUB_NAV;
  if (role === "project_coordinator") return COORDINATOR_HUB_NAV;
  if (role === "accounting") return ACCOUNTING_HUB_NAV;
  return null;
}

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
        {items.map((item) => {
          // Spec 169: every item is a first-layer destination — even the current
          // page stays a link to its root, so a click from a sub-page returns to
          // the section top (mirrors the bottom tab bar). aria-current marks the
          // "you are here" identity; the blue underline carries it visually.
          const isCurrent = item.href === currentHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent ? "page" : undefined}
              className={
                isCurrent
                  ? "border-action text-ink inline-flex min-h-11 items-center border-b-2 font-semibold focus:outline-none focus-visible:underline"
                  : "text-ink-secondary hover:text-ink inline-flex min-h-11 items-center border-b-2 border-transparent transition-colors focus:outline-none focus-visible:underline"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
