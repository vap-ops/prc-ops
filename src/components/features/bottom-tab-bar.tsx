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
import {
  CircleUserRound,
  ClipboardCheck,
  Contact,
  FolderKanban,
  ShoppingCart,
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

export const SA_TABS: ReadonlyArray<TabItem> = [
  // Spec 82 Unit 3: the project hub folded to the content-named /projects;
  // the tab points straight at it (and lights on every /projects/* screen).
  { label: "โครงการ", href: "/projects", icon: FolderKanban },
  { label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
  { label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

export const PM_TABS: ReadonlyArray<TabItem> = [
  { label: "รอตรวจ", href: "/pm", icon: ClipboardCheck },
  // Spec 82 Unit 3: same folded /projects hub for PM/super; the href lights
  // on the hub and every /projects/* detail screen, so no extra match.
  { label: "โครงการ", href: "/projects", icon: FolderKanban },
  { label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
  // Spec 81: contacts management (clients/suppliers/contractors). Phone-first
  // users had no way here — it was in the desktop HubNav only. Short tab label
  // "ติดต่อ" (the page itself is รายชื่อผู้ติดต่อ) to fit the 5-tab row.
  { label: "ติดต่อ", href: "/pm/contacts", icon: Contact },
  { label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

// Spec 70: procurement's worklist-only nav — the purchasing surface plus
// profile. No โครงการ (no project/WP hub in v1; projects SELECT deferred)
// and no รอตรวจ (procurement is not a decider).
export const PROCUREMENT_TABS: ReadonlyArray<TabItem> = [
  { label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
  { label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

function tabsForRole(role: string): ReadonlyArray<TabItem> | null {
  if (role === "site_admin") return SA_TABS;
  if (role === "project_manager" || role === "super_admin") return PM_TABS;
  if (role === "procurement") return PROCUREMENT_TABS;
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-300 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgba(0,0,0,0.1)] backdrop-blur sm:hidden"
    >
      <div className="mx-auto flex h-16 max-w-2xl items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          if (tab === active) {
            return (
              <span
                key={tab.href}
                aria-current="page"
                className="relative flex flex-1 flex-col items-center justify-center gap-1 text-blue-700"
              >
                {/* Visible active signal (spec 20) — a tint alone washes
                    out in sunlight; the indicator bar survives glare. */}
                <span
                  aria-hidden
                  className="absolute inset-x-4 top-0 h-1 rounded-b-full bg-blue-700"
                />
                <Icon aria-hidden className="size-6" />
                <span className="text-xs font-bold">{tab.label}</span>
              </span>
            );
          }
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-1 flex-col items-center justify-center gap-1 text-zinc-600 transition-colors hover:text-zinc-900 focus:outline-none focus-visible:text-zinc-900 active:scale-95"
            >
              <Icon aria-hidden className="size-6" />
              <span className="text-xs font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
