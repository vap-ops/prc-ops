"use client";

// Phone-first bottom tab bar (spec 19 §1) — the primary nav on phones,
// where thumbs actually are; the top HubNav strip is desktop-only.
// 'use client' is justified: usePathname for the active tab.
//
// Active-tab rule: LONGEST matching prefix wins — exactly one active
// tab, ever (naive startsWith would light both /pm and /pm/projects on
// every /pm/projects/* page). Cross-surface paths (a PM on the
// spec-12 back-target /sa/...) match no tab; the bar still renders for
// navigation and in-page back links remain the way "up" works.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isManagerRole } from "@/lib/auth/role-home";
import type { UserRole } from "@/lib/db/enums";
import {
  PendingApprovalsBadge,
  PendingPurchaseDecisionsBadge,
} from "@/components/features/dashboard/pending-approvals-badge";
import { SaActionBadge } from "@/components/features/sa/sa-action-badge";
import {
  Calculator,
  FileText,
  FolderKanban,
  Home,
  LayoutDashboard,
  Scale,
  Settings,
  ShoppingCart,
  Store,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface TabItem {
  label: string;
  href: string;
  icon: LucideIcon;
  // Extra path prefixes this tab claims beyond its own href. Lets a tab
  // stay lit on cross-surface paths (operator report 2026-06-11: PM/super
  // browsing /sa/* project screens lost the highlight entirely —
  // reverses spec 19's "cross-surface matches no tab" acceptance).
  // Longest-prefix-wins still guarantees exactly one active tab.
  match?: ReadonlyArray<string>;
}

// Spec 93: the bottom bar holds daily-decision surfaces; reference data
// (contacts, workers), finance (payroll), and the account (profile + logout)
// moved into the ตั้งค่า (/settings) hub. The ตั้งค่า tab lights on those
// sub-surfaces too (match) so the bar reflects where you are.
const SETTINGS_TAB: TabItem = {
  label: "ตั้งค่า",
  href: "/settings",
  icon: Settings,
  match: [
    "/profile",
    "/contacts",
    "/workers",
    "/equipment",
    "/catalog",
    // Spec 197 U1/U2: /store and /stock-count left settings for the per-project
    // คลัง surface (/projects/[id]/store), so the projects tab owns them now —
    // the settings tab no longer claims either.
    "/payroll",
    "/accounting",
  ],
};

// Spec 100: ภาพรวม graduated from a spec-98 coming-soon placeholder to a live
// tab (/dashboard, the role-aware overview). On SA + PM, NOT procurement
// (spec 70 lean worklist).
// Spec 183 U2: the review queue (/review) is now a sub-surface of ภาพรวม — the
// dashboard's รอตรวจ card is the way in — so the dashboard tab claims /review
// via match and stays lit on the queue + its detail screens. (SA shares this
// const but never reaches /review, so the match is inert for SA.)
const DASHBOARD_TAB: TabItem = {
  label: "ภาพรวม",
  href: "/dashboard",
  icon: LayoutDashboard,
  match: ["/review"],
};

// Spec 263 follow-up / spec 264 G4: the staff-registration approval queue was
// added to the desktop HubNav strip (spec 263 U3) but never to this bottom bar,
// so super_admin/project_director/procurement_manager on a phone had no way to
// reach /registrations at all. Role-neutral short label (bottom-tab space is
// tight — every other label here is 2-4 Thai chars; the page itself is titled
// the fuller "คำขอสมัคร").
const REGISTRATIONS_TAB: TabItem = {
  label: "คำขอสมัคร",
  href: "/registrations",
  icon: UserPlus,
};

// Spec 192 U4: the SA lands on the daily home (/sa, หน้าหลัก). ภาพรวม (the
// money-free portfolio overview) is dropped from the SA bar — the daily home
// supersedes it as the SA's at-a-glance surface — keeping the bar to four tabs.
export const SA_TABS: ReadonlyArray<TabItem> = [
  { label: "หน้าหลัก", href: "/sa", icon: Home },
  // Spec 82 Unit 3: the project hub folded to the content-named /projects;
  // the tab points straight at it (and lights on every /projects/* screen).
  { label: "โครงการ", href: "/projects", icon: FolderKanban },
  { label: "จัดซื้อ", href: "/requests", icon: ShoppingCart },
  SETTINGS_TAB,
];

// Spec 183 U2: รอตรวจ is no longer a tab — the review queue moved off the bar
// into the dashboard's รอตรวจ awareness card. ภาพรวม (DASHBOARD_TAB) carries the
// pending count and lights on /review. The PM tier lands on /dashboard now
// (roleHome), so the home tab still shows the queue at a glance.
export const PM_TABS: ReadonlyArray<TabItem> = [
  // Spec 82 Unit 3: same folded /projects hub for PM/super; the href lights
  // on the hub and every /projects/* detail screen, so no extra match.
  { label: "โครงการ", href: "/projects", icon: FolderKanban },
  { label: "จัดซื้อ", href: "/requests", icon: ShoppingCart },
  DASHBOARD_TAB,
  // Spec 263 follow-up: the approval queue, mirroring PM_HUB_NAV (desktop).
  REGISTRATIONS_TAB,
  SETTINGS_TAB,
];

// Spec 70: procurement's worklist-only nav — the purchasing surface plus
// settings. No โครงการ (no project/WP hub in v1) and no รอตรวจ (not a decider).
export const PROCUREMENT_TABS: ReadonlyArray<TabItem> = [
  { label: "จัดซื้อ", href: "/requests", icon: ShoppingCart },
  // Spec 262 follow-up: รายงาน (money reports). Longest-prefix wins so it lights
  // on /requests/reports without stealing the bare /requests worklist; it also
  // claims the /requests/orders PO list (a report sub-surface).
  { label: "รายงาน", href: "/requests/reports", icon: FileText, match: ["/requests/orders"] },
  // Spec 102: procurement browses projects read-only for purchase context
  // (lights on /projects + /projects/[id]).
  { label: "โครงการ", href: "/projects", icon: FolderKanban },
  // Spec 101: procurement curates the suppliers master (/contacts/vendors
  // renders suppliers-only for procurement). Longest-prefix wins over the
  // ตั้งค่า /contacts match, so this tab lights on the suppliers screen.
  { label: "ผู้ขาย", href: "/contacts/vendors", icon: Store },
  // Spec 309 follow-up: ค่าแรง on the phone bar too. Spec 309 surfaced it in the
  // desktop hub-nav, but that strip is desktop-only — so procurement on a phone
  // still reached the per-project wage roll-up only via ตั้งค่า → ทีมช่าง.
  { label: "ค่าแรง", href: "/payroll", icon: Wallet },
  SETTINGS_TAB,
];

// Spec 263 follow-up: procurement_manager (spec 261, ADR 0070) is a
// procurement superset with NO tab set at all before this fix — tabsForRole
// had no branch for it, so the role saw no bottom bar whatsoever. It gets the
// full PROCUREMENT_TABS set (it can do everything plain procurement can, plus
// the manager-only set) plus the staff-registration approval queue (spec 263 U3
// / spec 264 G4 — procurement_manager is a STAFF_APPROVAL_ROLES member).
export const PROCUREMENT_MANAGER_TABS: ReadonlyArray<TabItem> = [
  { label: "จัดซื้อ", href: "/requests", icon: ShoppingCart },
  { label: "รายงาน", href: "/requests/reports", icon: FileText, match: ["/requests/orders"] },
  { label: "โครงการ", href: "/projects", icon: FolderKanban },
  { label: "ผู้ขาย", href: "/contacts/vendors", icon: Store },
  // Spec 309 follow-up: mirrors PROCUREMENT_TABS — ค่าแรง on the phone bar.
  { label: "ค่าแรง", href: "/payroll", icon: Wallet },
  REGISTRATIONS_TAB,
  SETTINGS_TAB,
];

// Spec 143 U2 / ADR 0056: project_coordinator is a see-all oversight role. It
// browses every project (โครงการ) and reaches the universal account/settings hub
// — but NOT /review, /requests, or /dashboard (those don't admit it), so a lean
// two-tab set keeps every tab a live destination.
export const COORDINATOR_TABS: ReadonlyArray<TabItem> = [
  { label: "โครงการ", href: "/projects", icon: FolderKanban },
  SETTINGS_TAB,
];

// Spec 149 U9: the accounting role is onboarded onto the read-only ledger surface
// (/accounting) + the universal settings hub. A lean two-tab set, like the
// coordinator's — every tab a live destination.
export const ACCOUNTING_TABS: ReadonlyArray<TabItem> = [
  { label: "บัญชี", href: "/accounting", icon: Calculator },
  SETTINGS_TAB,
];

// Spec 284 U5 / ADR 0080: the Legal role's bottom bar — its /legal home
// (contracts + document approvals) + the universal settings hub. A lean two-tab
// set like ACCOUNTING_TABS; the home tab href lights on every /legal/* screen
// (longest-prefix), so contracts + the approval queue keep it lit. Short label
// (กฎหมาย) for the tight bottom-bar space — the page itself is titled ฝ่ายกฎหมาย.
export const LEGAL_TABS: ReadonlyArray<TabItem> = [
  { label: "กฎหมาย", href: "/legal", icon: Scale },
  SETTINGS_TAB,
];

function tabsForRole(role: string): ReadonlyArray<TabItem> | null {
  if (role === "site_admin") return SA_TABS;
  // Spec 152 / ADR 0058: project_director gets the PM tab set (see-all PM).
  if (isManagerRole(role as UserRole)) return PM_TABS;
  // Spec 263 follow-up: procurement_manager checked BEFORE plain procurement
  // (it is a distinct, wider set, not a fallthrough of the plain-procurement
  // branch below).
  if (role === "procurement_manager") return PROCUREMENT_MANAGER_TABS;
  if (role === "procurement") return PROCUREMENT_TABS;
  if (role === "project_coordinator") return COORDINATOR_TABS;
  if (role === "accounting") return ACCOUNTING_TABS;
  // Spec 284 U5 / ADR 0080: the Legal department tab set.
  if (role === "legal") return LEGAL_TABS;
  return null;
}

export function BottomTabBar({ role }: { role: string }) {
  const pathname = usePathname();
  const tabs = tabsForRole(role);
  if (!tabs) return null;

  // Longest matching prefix across href + extra match prefixes — still
  // exactly one active tab; the longest claim wins regardless of which
  // tab owns it.
  let active: TabItem | null = null;
  let activeLen = -1;
  for (const tab of tabs) {
    for (const prefix of [tab.href, ...(tab.match ?? [])]) {
      const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (matches && prefix.length > activeLen) {
        active = tab;
        activeLen = prefix.length;
      }
    }
  }

  return (
    <nav
      aria-label="เมนูหลัก"
      className="border-edge-strong bg-card/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgba(0,0,0,0.1)] backdrop-blur sm:hidden"
    >
      <div className="mx-auto flex h-16 max-w-2xl items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          // Every tab is a first-layer destination: even the ACTIVE tab is a link
          // to its root, so a tap from a sub-page returns to the top of the
          // section (operator 2026-06-21 — "all the bottom tabs are first layer").
          // aria-current still marks "you are here"; the indicator bar + bold +
          // text-action carry the active identity (spec 20).
          const isActive = tab === active;
          // Spec 183 U3: the pending-approval count rides the ภาพรวม tab for the
          // PM tier — the review queue is no longer a tab, so this is the
          // at-a-glance count while anywhere in the app. site_admin shares the
          // tab but does not approve, so no badge.
          const showApprovalsBadge = tab.href === "/dashboard" && isManagerRole(role as UserRole);
          // Spec 184 U1: purchase requests awaiting the PM tier's decision ride
          // the จัดซื้อ tab (SA requesters / procurement processors share it but
          // don't decide, so no badge for them).
          const showPurchaseBadge = tab.href === "/requests" && isManagerRole(role as UserRole);
          // Spec 218: WPs the PM/defect bounced back to the SA ride the หน้าหลัก
          // tab, so the SA sees them while anywhere in the app. site_admin only —
          // super/PM use a different bar and don't field rework.
          const showReworkBadge = tab.href === "/sa" && role === "site_admin";
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "text-action relative flex flex-1 flex-col items-center justify-center gap-1 transition-transform focus:outline-none active:scale-95"
                  : "text-ink-secondary hover:text-ink focus-visible:text-ink flex flex-1 flex-col items-center justify-center gap-1 transition-colors focus:outline-none active:scale-95"
              }
            >
              {/* Visible active signal (spec 20) — a tint alone washes out in
                  sunlight; the indicator bar survives glare. */}
              {isActive ? (
                <span
                  aria-hidden
                  className="bg-action absolute inset-x-4 top-0 h-1 rounded-b-full"
                />
              ) : null}
              <span className="relative">
                <Icon aria-hidden className="size-6" />
                {showApprovalsBadge ? <PendingApprovalsBadge /> : null}
                {showPurchaseBadge ? <PendingPurchaseDecisionsBadge /> : null}
                {showReworkBadge ? <SaActionBadge /> : null}
              </span>
              <span className={isActive ? "text-xs font-bold" : "text-xs font-medium"}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
