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
  FolderKanban,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

export interface TabItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const SA_TABS: ReadonlyArray<TabItem> = [
  { label: "โครงการ", href: "/sa", icon: FolderKanban },
  { label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
  { label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

export const PM_TABS: ReadonlyArray<TabItem> = [
  { label: "รอตรวจ", href: "/pm", icon: ClipboardCheck },
  { label: "โครงการ", href: "/pm/projects", icon: FolderKanban },
  { label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
  { label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

function tabsForRole(role: string): ReadonlyArray<TabItem> | null {
  if (role === "site_admin") return SA_TABS;
  if (role === "project_manager" || role === "super_admin") return PM_TABS;
  return null;
}

export function BottomTabBar({ role }: { role: string }) {
  const pathname = usePathname();
  const tabs = tabsForRole(role);
  if (!tabs) return null;

  let active: TabItem | null = null;
  for (const tab of tabs) {
    const matches = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    if (matches && (!active || tab.href.length > active.href.length)) {
      active = tab;
    }
  }

  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <div className="mx-auto flex h-16 max-w-2xl items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          if (tab === active) {
            return (
              <span
                key={tab.href}
                aria-current="page"
                className="flex flex-1 flex-col items-center justify-center gap-1 text-zinc-100"
              >
                <Icon aria-hidden className="size-5 text-emerald-400" />
                <span className="text-[11px] font-medium">{tab.label}</span>
              </span>
            );
          }
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-1 flex-col items-center justify-center gap-1 text-zinc-500 transition-colors hover:text-zinc-300 focus:outline-none focus-visible:text-zinc-200"
            >
              <Icon aria-hidden className="size-5" />
              <span className="text-[11px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
