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
  maxWidthClass: "max-w-2xl" | "max-w-3xl" | "max-w-2xl lg:max-w-5xl" | "max-w-3xl lg:max-w-5xl";
}

export function AppHeader({ kicker, fullName, title, maxWidthClass }: AppHeaderProps) {
  const heading = title ?? (fullName ? `สวัสดี คุณ${fullName}` : "สวัสดี");
  return (
    // Spec 38: the brand band (direction ข) — the one dark surface in
    // the app. White heading on slate-900 is ~17:1; the amber wordmark
    // accent is decorative bold text on near-black (≈10:1).
    <header className="border-b border-slate-800 bg-slate-900 px-5 py-4">
      <div className={`mx-auto flex ${maxWidthClass} items-center justify-between gap-3`}>
        <div>
          <p className="text-xs font-bold tracking-wide text-white">
            PRC <span className="text-amber-400">Ops</span>
            <span className="mx-2 font-normal text-slate-500">·</span>
            <span className="font-semibold tracking-wider text-amber-400 uppercase">{kicker}</span>
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-white">{heading}</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Desktop-only: the bottom tab bar carries โปรไฟล์ on phones
              (spec 19 §2 — one profile affordance per viewport). */}
          <Link
            href="/profile"
            className="hidden text-sm font-medium text-white transition-colors hover:text-amber-300 hover:underline focus:outline-none focus-visible:underline sm:inline"
          >
            โปรไฟล์
          </Link>
          <LogoutButton variant="dark" />
        </div>
      </div>
    </header>
  );
}
