import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";

// Shared hub-page header (spec 17). One source for the kicker + greeting
// block that /sa, /pm, /pm/requests, /requests, /pm/projects, and the
// reports page each hand-rolled before. Detail screens (breadcrumb-style
// headers) and the bespoke landing/login/profile/coming-soon layouts do
// NOT use this component.
//
// `maxWidthClass` is the page's existing container width passed through
// verbatim — unifying the 2xl/3xl split is a recorded operator question,
// not this refactor's call. Same for `showProfileLink`: /pm/projects and
// the reports page historically render only the logout button.

interface AppHeaderProps {
  kicker: string;
  /** Greeting variant: สวัสดี คุณ{fullName} with a bare สวัสดี fallback. */
  fullName?: string | null;
  /** Fixed-title variant — overrides the greeting (reports page). */
  title?: string;
  maxWidthClass: "max-w-2xl" | "max-w-3xl";
  showProfileLink?: boolean;
}

export function AppHeader({
  kicker,
  fullName,
  title,
  maxWidthClass,
  showProfileLink = true,
}: AppHeaderProps) {
  const heading = title ?? (fullName ? `สวัสดี คุณ${fullName}` : "สวัสดี");
  return (
    <header className="border-b border-zinc-800 px-5 py-4">
      <div className={`mx-auto flex ${maxWidthClass} items-center justify-between gap-3`}>
        <div>
          <p className="text-xs tracking-wider text-zinc-500 uppercase">{kicker}</p>
          <h1 className="text-lg font-semibold tracking-tight">{heading}</h1>
        </div>
        <div className="flex items-center gap-3">
          {showProfileLink ? (
            <Link
              href="/profile"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:underline"
            >
              โปรไฟล์
            </Link>
          ) : null}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
