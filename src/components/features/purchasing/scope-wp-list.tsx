// Spec 327 U2 — the ขอบเขต WP list: the selected project's work packages
// wearing procurement supply chips (open / incoming / next arrival), late-risk
// conflicts stated in place (§0.2), and the create-plan door on no-plan rows
// (§0.3). A procurement VARIANT — deliberately not bolted onto the SA/PM
// work-package-list.tsx (a 3-lens shared component whose lenses procurement
// data doesn't belong in). Grouped roster per the spec-270 idiom. Server
// component — pure render over precomputed overlay data.

import Link from "next/link";

import { EmptyNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { WpCategoryCode } from "@/components/features/work-packages/wp-category-code";
import type { WorkPackageStatus } from "@/lib/db/enums";
import { formatThaiDate, INCOMING_LENS_LABEL, WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { withBackFrom } from "@/lib/nav/back-href";
import { projectHref, supplyPlanHref, workPackageHref } from "@/lib/nav/project-paths";
import { buildGroupedRoster } from "@/lib/work-packages/group-roster";
import type { ProjectBucket, WpSupplyOverlay } from "@/lib/purchasing/wp-supply-overlay";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { workPackageStatusIcon } from "@/lib/status-icons";

/** The scope view's back-threading origin (nav-coherence Decision 1 — the WP
 * detail is multi-parent; from here, back must return to the scope view). */
const SCOPE_FROM = "/procurement/scope";

export interface ScopeWpItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  isGroup: boolean;
  parentId: string | null;
  plannedStart: string | null;
  /** Reconciled GLOBAL work-category code (W0x), or null. */
  categoryCode: string | null;
}

function SupplyChips({ overlay }: { overlay: WpSupplyOverlay }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {overlay.openCount > 0 ? (
        <span className="text-ink-secondary text-meta shrink-0">ขอซื้อ {overlay.openCount}</span>
      ) : null}
      {overlay.incomingCount > 0 ? (
        <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
          {INCOMING_LENS_LABEL.onroute} {overlay.incomingCount}
        </span>
      ) : null}
      {overlay.nextArrival !== null ? (
        <span className="text-ink-secondary text-meta shrink-0">
          ถึง {formatThaiDate(overlay.nextArrival)}
        </span>
      ) : null}
    </span>
  );
}

function WpRow({
  projectId,
  wp,
  overlay,
}: {
  projectId: string;
  wp: ScopeWpItem;
  overlay: WpSupplyOverlay;
}) {
  const late = overlay.lateEta !== null && wp.plannedStart !== null;
  return (
    <div
      className={`rounded-card shadow-card bg-card flex flex-col gap-2 border px-4 py-3 ${
        late ? "border-danger" : "border-edge"
      }`}
    >
      <Link
        href={withBackFrom(workPackageHref(projectId, wp.id), SCOPE_FROM)}
        className="text-ink flex min-h-11 min-w-0 items-center gap-3"
      >
        <WpCategoryCode code={wp.code} categoryCode={wp.categoryCode} className="text-sm" />
        <span className="text-body min-w-0 flex-1 truncate font-semibold">{wp.name}</span>
        <StatusPill
          pillClasses={workPackageStatusPillClasses(wp.status)}
          icon={workPackageStatusIcon(wp.status)}
        >
          {WORK_PACKAGE_STATUS_LABEL[wp.status]}
        </StatusPill>
      </Link>
      {late ? (
        <p className="text-danger text-meta font-semibold">
          ของถึง {formatThaiDate(overlay.lateEta!)} — งานเริ่ม {formatThaiDate(wp.plannedStart!)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <SupplyChips overlay={overlay} />
        {!overlay.hasPlan ? (
          <Link
            href={withBackFrom(supplyPlanHref(projectId), SCOPE_FROM)}
            className="border-edge text-ink-secondary hover:bg-sunk text-meta shrink-0 rounded-full border px-2 py-0.5"
          >
            ยังไม่มีแผนจัดหา →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

const ZERO_OVERLAY: WpSupplyOverlay = {
  openCount: 0,
  incomingCount: 0,
  nextArrival: null,
  lateEta: null,
  hasPlan: false,
};

export function ScopeWpList({
  projectId,
  wps,
  overlay,
  projectBucket,
}: {
  projectId: string;
  wps: ReadonlyArray<ScopeWpItem>;
  overlay: ReadonlyMap<string, WpSupplyOverlay>;
  projectBucket: ProjectBucket;
}) {
  const roster = buildGroupedRoster(wps);
  const of = (id: string): WpSupplyOverlay => overlay.get(id) ?? ZERO_OVERLAY;
  const bucketVisible = projectBucket.openCount > 0 || projectBucket.incomingCount > 0;

  if (wps.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyNotice>
          ยังไม่มีงานในโครงการนี้ —{" "}
          <Link href={projectHref(projectId)} className="text-action underline">
            เปิดหน้าโครงการ
          </Link>
        </EmptyNotice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Anchorless / store-restock PRs — the คลัง project bucket (§0.1). */}
      {bucketVisible ? (
        <div className="rounded-card shadow-card border-edge bg-sunk text-ink flex min-h-11 flex-wrap items-center gap-3 border px-4 py-3">
          <span className="text-body min-w-0 flex-1 font-semibold">คลัง · ระดับโครงการ</span>
          <span className="text-ink-secondary text-meta shrink-0">
            ขอซื้อ {projectBucket.openCount}
          </span>
          {projectBucket.incomingCount > 0 ? (
            <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
              {INCOMING_LENS_LABEL.onroute} {projectBucket.incomingCount}
            </span>
          ) : null}
          {projectBucket.nextArrival !== null ? (
            <span className="text-ink-secondary text-meta shrink-0">
              ถึง {formatThaiDate(projectBucket.nextArrival)}
            </span>
          ) : null}
        </div>
      ) : null}

      {roster.sections.map((section) => (
        <section key={section.group.id} className="flex flex-col gap-2">
          <h3 className="text-body text-ink-secondary flex items-center gap-2 font-semibold">
            <WpCategoryCode
              code={section.group.code}
              categoryCode={section.group.categoryCode}
              className="text-sm"
            />
            <span className="min-w-0 flex-1 truncate">{section.group.name}</span>
            <span className="text-meta shrink-0 font-normal">
              {section.completeCount}/{section.totalCount}
            </span>
          </h3>
          {section.children.map((child) => (
            <WpRow key={child.id} projectId={projectId} wp={child} overlay={of(child.id)} />
          ))}
        </section>
      ))}

      {roster.ungrouped.map((leaf) => (
        <WpRow key={leaf.id} projectId={projectId} wp={leaf} overlay={of(leaf.id)} />
      ))}
    </div>
  );
}
