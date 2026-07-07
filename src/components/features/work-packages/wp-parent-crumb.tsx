// Spec 270 U4 — the งานย่อย detail's parent breadcrumb (WP-05 › WP-05-03).
// The parent งาน links to its oversight page; the current code stays text.
// Server-safe (no hooks).

import Link from "next/link";
import { workPackageHref } from "@/lib/nav/project-paths";
import { WP_GROUP_LABEL } from "@/lib/i18n/labels";

export interface CrumbParent {
  id: string;
  code: string;
  name: string;
}

export function WpParentCrumb({
  projectId,
  parent,
  currentCode,
}: {
  projectId: string;
  parent: CrumbParent;
  currentCode: string;
}) {
  return (
    <p className="text-meta text-ink-secondary flex min-w-0 items-center gap-1 font-mono">
      <Link
        href={workPackageHref(projectId, parent.id)}
        aria-label={`${WP_GROUP_LABEL} ${parent.code} ${parent.name}`}
        className="text-action focus-visible:ring-action max-w-[60%] truncate font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
      >
        {parent.code}
      </Link>
      <span aria-hidden="true">›</span>
      <span>{currentCode}</span>
    </p>
  );
}
