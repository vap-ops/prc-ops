import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { AvatarSurface } from "@/components/features/avatar-surface";
import { DisplayNameForm } from "@/components/features/display-name-form";
import { createClient } from "@/lib/db/server";
import { type UserRole } from "@/lib/auth/role-home";

// Display labels for every role that lands here. site_admin and project_manager
// are redirected away (their landings exist), so they're intentionally absent.
const UNSERVED_ROLE_LABEL: Record<Exclude<UserRole, "site_admin" | "project_manager">, string> = {
  visitor: "Visitor",
  super_admin: "Super Admin",
  project_coordinator: "Project Coordinator",
  procurement: "Procurement",
  technician: "Technician",
  hr: "HR",
  subcon_manager: "Subcontractor Manager",
  accounting: "Accounting",
};

// Session check uses getClaims() — local JWT verify against the cached JWKS,
// no Auth-server round-trip on the render path. See ADR 0021. The middleware
// keeps getUser() once per request for the authoritative refresh.

export default async function ComingSoonPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) {
    redirect("/login");
  }
  const userId = claimsData.claims.sub;

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name, line_avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (!row) {
    console.error("[/coming-soon] users row missing", { userId });
    redirect("/login");
  }

  const role = row.role as UserRole;

  // Bounce served roles to their proper home. Each branch ends in redirect()
  // which returns `never`, so after these two lines `role` is narrowed to the
  // unserved-role union — exactly the keys of UNSERVED_ROLE_LABEL.
  if (role === "site_admin") redirect("/sa");
  if (role === "project_manager") redirect("/pm");

  const displayName = UNSERVED_ROLE_LABEL[role] ?? role;
  const greeting = row.full_name ?? "there";
  const initialName = row.full_name ?? "";
  const lineAvatarUrl = row.line_avatar_url;

  // super_admin is the only "unserved" role that genuinely needs to
  // *reach* the served surfaces — every other unserved role waits for
  // its own tools to ship. Give super_admin an operator hub instead of
  // the wait-for-tools copy. /sa and /pm and /pm/projects all admit
  // super_admin via their existing requireRole() guards (no auth
  // change in this unit; this is purely a render branch).
  if (role === "super_admin") {
    return (
      <OperatorHub
        greeting={greeting}
        displayName={displayName}
        initialName={initialName}
        lineAvatarUrl={lineAvatarUrl}
        fullName={row.full_name}
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <AvatarSurface lineUrl={lineAvatarUrl} fullName={row.full_name} size={72} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Hi, {greeting}</h1>
        <p className="text-lg text-zinc-400">You&apos;re signed in as {displayName}.</p>
        <p className="text-sm text-zinc-500">
          PRC Ops is rolling out features in phases. Tools for your role aren&apos;t ready yet —
          we&apos;ll let you know when they go live. For now, please continue using your current
          process.
        </p>
        <div className="text-left">
          <DisplayNameForm initialName={initialName} />
        </div>
        <div className="flex justify-center pt-2">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}

interface OperatorHubProps {
  greeting: string;
  displayName: string;
  initialName: string;
  lineAvatarUrl: string | null;
  fullName: string | null;
}

interface HubLink {
  href: string;
  label: string;
  hint: string;
}

const HUB_LINKS: ReadonlyArray<HubLink> = [
  {
    href: "/sa",
    label: "Site admin",
    hint: "Project list, work packages, photo upload.",
  },
  {
    href: "/pm",
    label: "Approval queue",
    hint: "Work packages awaiting PM review.",
  },
  {
    href: "/pm/projects",
    label: "Projects & reports",
    hint: "Generate and download project PDF reports.",
  },
  {
    href: "/profile",
    label: "Profile",
    hint: "Edit your display name.",
  },
];

function OperatorHub({
  greeting,
  displayName,
  initialName,
  lineAvatarUrl,
  fullName,
}: OperatorHubProps) {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="space-y-1">
          <p className="text-xs tracking-wider text-zinc-500 uppercase">Operator console</p>
          <div className="flex items-center gap-3">
            <AvatarSurface lineUrl={lineAvatarUrl} fullName={fullName} size={48} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Hi, {greeting}</h1>
              <p className="text-sm text-zinc-500">Signed in as {displayName}.</p>
            </div>
          </div>
        </header>

        <nav aria-label="Operator destinations" className="flex flex-col gap-2">
          {HUB_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-base font-medium text-zinc-100">{link.label}</p>
                <p className="text-xs text-zinc-500">{link.hint}</p>
              </div>
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-300"
              >
                →
              </span>
            </Link>
          ))}
        </nav>

        <DisplayNameForm initialName={initialName} />

        <div className="flex justify-end pt-2">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
