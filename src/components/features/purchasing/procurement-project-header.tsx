// Spec 327 U6 — the shared S/T/R view header. The PROJECT NAME is the door to
// หน้าโครงการ (checkpoint-2 finding: the project page took 5-6 taps while the
// workspace already held the selection — now it's one tap from every tab),
// ?from-threaded so its back chip returns to the tab you left. เปลี่ยนโครงการ
// stays beside it. Server component, shared by scope/time/resources hosts.

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { withBackFrom } from "@/lib/nav/back-href";
import { projectHref } from "@/lib/nav/project-paths";

export function ProcurementProjectHeader({
  projectId,
  projectName,
  from,
}: {
  projectId: string;
  projectName: string;
  from: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Link
        href={withBackFrom(projectHref(projectId), from)}
        // Accessible-name floor: an unresolved name would leave an icon-only
        // link with no name (fresh-eyes catch).
        aria-label={projectName || "เปิดหน้าโครงการ"}
        className="text-body text-ink hover:text-action flex min-h-11 min-w-0 flex-1 items-center gap-1 font-semibold"
      >
        <span className="min-w-0 truncate">{projectName}</span>
        <ChevronRight aria-hidden className="text-ink-muted size-4 shrink-0" />
      </Link>
      <Link
        href="/procurement"
        className="text-action text-meta inline-flex min-h-11 shrink-0 items-center underline"
      >
        เปลี่ยนโครงการ
      </Link>
    </div>
  );
}
