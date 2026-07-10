// Spec 270 U4 — the งาน (group WP) detail body: OVERSIGHT ONLY. A งาน is a
// grouping entity (ADR 0074; operator directive 2026-07-06): no photos, no
// manual status/priority, no money writes — the DB guards reject them all, and
// this view simply never offers them. Content = the rollup summary (derived
// status pill + n/m เสร็จ + progress bar), a manager-only read-only money card
// (leaf-bound sums, returns netted — see group-detail.ts), and the งานย่อย
// list. Server-safe (no hooks) — rendered by the WP detail page's group branch.

import { EmptyNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { WorklistRow } from "@/components/features/chrome/worklist-row";
import { workPackageHref } from "@/lib/nav/project-paths";
import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";
import type { WorkPackageStatus } from "@/lib/db/enums";
import { baht } from "@/lib/format";
import { WORK_PACKAGE_STATUS_LABEL, WP_GROUP_LABEL, WP_LEAF_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { workPackageStatusIcon } from "@/lib/status-icons";
import { CARD } from "@/lib/ui/classes";
import {
  ACTION_BAND_META,
  deriveActionBand,
  type WpPriority,
} from "@/lib/work-packages/action-bands";
import type { GroupSpendSummary } from "@/lib/work-packages/group-detail";

export interface GroupChildItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  hasContractor: boolean;
  priority: WpPriority;
  isCritical: boolean;
}

export interface GroupDetailViewProps {
  projectId: string;
  group: { id: string; code: string; name: string; status: WorkPackageStatus };
  /** งานย่อย inside, already sorted by hierarchical code. */
  childItems: ReadonlyArray<GroupChildItem>;
  /** Read-only leaf-bound aggregates — null hides the card (manager gate upstream). */
  money: GroupSpendSummary | null;
  /** Whether this viewer may open the child งานย่อย details. */
  canOpenChildren: boolean;
}

export function GroupDetailView({
  projectId,
  group,
  childItems,
  money,
  canOpenChildren,
}: GroupDetailViewProps) {
  const progress = deriveDeliverableProgress(childItems.map((c) => c.status));
  return (
    <div className="flex flex-col gap-4">
      {/* Rollup summary — the group's own status IS the derived truth. */}
      <section className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span className="border-edge bg-sunk text-meta text-ink-secondary rounded-md border px-1.5 py-0.5 font-bold">
              {WP_GROUP_LABEL}
            </span>
            <span className="text-meta text-ink-secondary">
              สถานะคำนวณจาก{WP_LEAF_LABEL}อัตโนมัติ
            </span>
          </span>
          <StatusPill
            pillClasses={workPackageStatusPillClasses(group.status)}
            icon={workPackageStatusIcon(group.status)}
          >
            {WORK_PACKAGE_STATUS_LABEL[group.status]}
          </StatusPill>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${group.name} — เสร็จแล้ว ${progress.percent}%`}
            className="bg-edge block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
          >
            <span
              className="bg-done block h-full rounded-full"
              style={{ width: `${progress.percent}%` }}
            />
          </span>
          <span className="text-meta text-ink-secondary shrink-0 font-semibold">
            {progress.completeCount}/{progress.totalCount} เสร็จ
          </span>
        </div>
      </section>

      {/* Read-only money aggregates (manager-only; หักคืนเข้าคลัง = the
          spec-209 returns netting, mirroring the dashboard). */}
      {money ? (
        <section className={CARD}>
          <p className="text-body text-ink font-semibold">ค่าใช้จ่ายรวมของ{WP_GROUP_LABEL}นี้</p>
          <dl className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-body text-ink-secondary">ค่าแรงรวม</dt>
              <dd className="text-body text-ink font-semibold tabular-nums">
                {baht(money.laborTotal)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-body text-ink-secondary">
                ค่าวัสดุ + เบิกจากคลัง (หักคืนเข้าคลัง {baht(money.storeReturns)})
              </dt>
              <dd className="text-body text-ink font-semibold tabular-nums">
                {baht(money.materialNet)}
              </dd>
            </div>
            <div className="border-edge flex items-center justify-between gap-3 border-t pt-1.5">
              <dt className="text-body text-ink font-bold">รวม</dt>
              <dd className="text-body text-ink font-bold tabular-nums">{baht(money.total)}</dd>
            </div>
          </dl>
          <p className="text-meta text-ink-secondary mt-2">
            รวมจาก{WP_LEAF_LABEL} {childItems.length} รายการ — ดูอย่างเดียว (บันทึกเงิน/ของทำที่
            {WP_LEAF_LABEL})
          </p>
        </section>
      ) : null}

      {/* The งานย่อย inside. */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-section text-ink font-semibold">
          {WP_LEAF_LABEL}ใน{WP_GROUP_LABEL}นี้ ({childItems.length})
        </h2>
        {childItems.length === 0 ? (
          <EmptyNotice>
            ยังไม่มี{WP_LEAF_LABEL}ใน{WP_GROUP_LABEL}นี้
          </EmptyNotice>
        ) : (
          childItems.map((c, i) => (
            <WorklistRow
              key={c.id}
              projectId={projectId}
              wp={{
                id: c.id,
                code: c.code,
                name: c.name,
                status: c.status,
                hasContractor: c.hasContractor,
                priority: c.priority,
                isCritical: c.isCritical,
                deliverableLabel: null,
              }}
              spine={ACTION_BAND_META[deriveActionBand(c.status)].spine}
              compact
              enterIndex={i}
              canOpen={canOpenChildren}
              backFrom={workPackageHref(projectId, group.id)}
            />
          ))
        )}
      </section>
    </div>
  );
}
