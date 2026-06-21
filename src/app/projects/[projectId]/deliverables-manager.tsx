// Spec 164 U1 — the "งวดงาน" manager section on the project page. Server
// component: lists the project's งวด (code · name · N งาน) and hosts the
// AddDeliverableSheet. This is the missing home/door for deliverables — before
// U1 there was no in-app way to see or add them (they only came from a seed).
// PM-only / open-project; the add button is the AddDeliverableSheet client island.

import { AddDeliverableSheet } from "./add-deliverable-sheet";
import { ImportDeliverablesSheet } from "./import-deliverables-sheet";
import { GroupWorkPackagesSheet } from "./group-work-packages-sheet";
import { EditDeliverableSheet } from "./edit-deliverable-sheet";

export interface DeliverableManagerRow {
  id: string;
  code: string;
  name: string;
  wpCount: number;
}

export interface UngroupedWpRow {
  id: string;
  code: string;
  name: string;
}

export function DeliverablesManager({
  projectId,
  deliverables,
  ungroupedWorkPackages,
}: {
  projectId: string;
  deliverables: DeliverableManagerRow[];
  ungroupedWorkPackages: UngroupedWpRow[];
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="deliverables" className="text-section text-ink font-semibold">
          งวดงาน
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ImportDeliverablesSheet projectId={projectId} />
          <AddDeliverableSheet projectId={projectId} />
        </div>
      </div>

      {deliverables.length === 0 ? (
        <div className="rounded-card border-edge bg-sunk text-ink-secondary border px-4 py-3 text-sm">
          ยังไม่มีงวดงาน — เพิ่มงวดเพื่อจัดกลุ่มรายการงาน แล้วงานจะถูกแบ่งตามงวดในมุมมอง “ตามงวดงาน”
        </div>
      ) : (
        <ul className="rounded-card border-edge bg-card divide-edge divide-y border">
          {deliverables.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2">
              <span className="text-meta text-ink-secondary font-mono">{d.code}</span>
              <span className="text-body text-ink min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-meta text-ink-secondary shrink-0">{d.wpCount} งาน</span>
              <EditDeliverableSheet
                projectId={projectId}
                deliverableId={d.id}
                code={d.code}
                name={d.name}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Spec 164 U3: the ungrouped funnel — drives bulk งาน→งวด mapping. Only
          when งวด exist (else the empty-state above tells them to create one). */}
      {deliverables.length > 0 && ungroupedWorkPackages.length > 0 && (
        <div className="rounded-card border-attn-edge bg-attn-soft text-attn-ink mt-3 flex flex-wrap items-center justify-between gap-3 border px-4 py-3">
          <span className="text-sm font-medium">
            {ungroupedWorkPackages.length} งานยังไม่อยู่ในงวด
          </span>
          <GroupWorkPackagesSheet
            projectId={projectId}
            ungroupedWorkPackages={ungroupedWorkPackages}
            deliverables={deliverables.map((d) => ({ id: d.id, code: d.code, name: d.name }))}
          />
        </div>
      )}
    </section>
  );
}
