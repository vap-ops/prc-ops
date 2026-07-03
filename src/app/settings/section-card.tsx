import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { ComingSoonBadge } from "@/components/features/chrome/coming-soon-badge";
import { visibleEntries, type SettingsSection } from "./sections";
import type { UserRole } from "@/lib/auth/role-home";

// The /settings grouped-card renderer: ONE bordered card per section, rows
// separated by hairline dividers (the settings/usage + friction-map idiom)
// instead of each row floating as its own card. overflow-hidden clips row
// hover to the card radius; rows therefore use ring-inset so the focus ring
// survives the clip (the photo-lightbox pairing).

export const GROUP_CARD =
  "border-edge bg-card rounded-control divide-edge flex flex-col divide-y overflow-hidden";

// Grouped row — no per-row border/bg/radius (the card owns those).
export const ROW =
  "hover:bg-sunk focus-visible:ring-action flex items-center gap-3 px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset";

export function SettingsSectionCard({
  section,
  role,
  badges,
}: {
  section: SettingsSection;
  role: UserRole;
  // Awareness pills keyed by entry href (spec 201 A2) — counts are fetched by
  // the page (server-side), injected here so the config stays ReactNode-free.
  badges?: Record<string, ReactNode>;
}) {
  const entries = visibleEntries(section, role);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-meta text-ink-secondary font-semibold">{section.title}</h2>
      <div className={`${GROUP_CARD} border`}>
        {entries.map((entry) =>
          entry.kind === "link" ? (
            <SettingsLink
              key={entry.href}
              href={entry.href}
              icon={entry.icon}
              label={entry.label}
              hint={entry.hint}
              badge={badges?.[entry.href]}
            />
          ) : (
            <ComingSoonRow
              key={entry.key}
              icon={entry.icon}
              label={entry.label}
              hint={entry.hint}
            />
          ),
        )}
      </div>
    </div>
  );
}

export function SettingsLink({
  href,
  icon: Icon,
  label,
  hint,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  badge?: ReactNode;
}) {
  return (
    <Link href={href} className={ROW}>
      <span className="bg-sunk text-ink-secondary rounded-control inline-flex h-9 w-9 shrink-0 items-center justify-center">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink text-body block font-semibold">{label}</span>
        <span className="text-ink-secondary text-meta block">{hint}</span>
      </span>
      {badge}
      <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
    </Link>
  );
}

// Spec 98: a settings row for a not-yet-built menu — greyed, non-link, carries
// the เร็วๆนี้ badge where the chevron normally sits.
export function ComingSoonRow({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <div aria-disabled="true" className="flex items-center gap-3 px-4 py-3">
      <span className="bg-sunk text-ink-muted rounded-control inline-flex h-9 w-9 shrink-0 items-center justify-center">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink-secondary text-body block font-semibold">{label}</span>
        <span className="text-ink-muted text-meta block">{hint}</span>
      </span>
      <ComingSoonBadge />
    </div>
  );
}
