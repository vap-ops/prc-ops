import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";

// Shared hub-page header (spec 17). One source for the kicker + greeting
// block that /sa, /pm, /requests, /pm/projects, and the reports page
// each hand-rolled before. Detail screens (breadcrumb-style headers)
// and the bespoke landing/login/profile/coming-soon layouts do NOT use
// this component.
//
// Every hub header carries the โปรไฟล์ link + logout (spec 18
// normalized away the two historical hide-sites). `maxWidthClass`
// remains a prop for the hub/detail width split.

interface AppHeaderProps {
  kicker: string;
  /** Greeting variant: สวัสดี คุณ{fullName} with a bare สวัสดี fallback. */
  fullName?: string | null;
  /** Fixed-title variant — overrides the greeting (reports page). */
  title?: string;
  maxWidthClass: "max-w-2xl" | "max-w-3xl";
}

export function AppHeader({ kicker, fullName, title, maxWidthClass }: AppHeaderProps) {
  const heading = title ?? (fullName ? `สวัสดี คุณ${fullName}` : "สวัสดี");
  return (
    <header className="border-b border-zinc-800 px-5 py-4">
      <div className={`mx-auto flex ${maxWidthClass} items-center justify-between gap-3`}>
        <div>
          <p className="text-xs tracking-wider text-zinc-500 uppercase">{kicker}</p>
          <h1 className="text-lg font-semibold tracking-tight">{heading}</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Desktop-only: the bottom tab bar carries โปรไฟล์ on phones
              (spec 19 §2 — one profile affordance per viewport). */}
          <Link
            href="/profile"
            className="hidden text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:underline sm:inline"
          >
            โปรไฟล์
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
