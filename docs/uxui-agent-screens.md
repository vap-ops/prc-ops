# PRC Ops — Top-level screen files (the gap you flagged in Unit 1)

> These are the files absent from the original bundle. Same rule: no repo
> access, everything inline under `===== FILE: <path> =====`. Return full
> token-adopted contents or precise diffs against what is pasted here.
>
> These are the REAL composition of the two proof screens:
>
> - project page + work-package-list = the deliverable-grouped WP list
> - work-packages/[workPackageId]/page = the WP detail (the heart)
> - phase-uploader = the 3-phase photo capture on WP detail

===== FILE: src/app/projects/[projectId]/page.tsx =====

import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { FileText, Settings } from "lucide-react";
import { SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { projectSettingsHref, reportsHref } from "@/lib/nav/project-paths";
import { ICON_CHIP_MUTED, SECTION_HEADING } from "@/lib/ui/classes";
import { DetailHeader } from "@/components/features/detail-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { PROJECT_TYPE_LABEL } from "@/lib/projects/validate-settings";
import { WorkPackageList } from "./work-package-list";

interface PageProps {
params: Promise<{ projectId: string }>;
}

export const metadata = { title: "รายการงาน" };

export default async function ProjectWorkPackagesPage({ params }: PageProps) {
const { projectId } = await params;
const ctx = await requireRole(SITE_STAFF_ROLES);
const supabase = await createClient();

const { data: project } = await supabase
.from("projects")
.select("id, code, name, site_address, client_id, project_lead_id, project_type")
.eq("id", projectId)
.maybeSingle();

if (!project) {
notFound();
}

// Spec 79: project-context lines (client name, internal lead, type, site).
// budget is intentionally NOT read here (money — admin-only, PM screens).
const [clientRow, { data: memberRows }] = await Promise.all([
project.client_id
? supabase.from("clients").select("name").eq("id", project.client_id).maybeSingle()
: Promise.resolve({ data: null }),
supabase.from("project_members").select("user_id").eq("project_id", project.id),
]);
const clientName = clientRow.data?.name ?? null;
const memberIds = (memberRows ?? []).map((m) => m.user_id);
// Resolve the lead + member display names in one admin lookup (users RLS is read-self).
const nameIds = [
...new Set([...(project.project_lead_id ? [project.project_lead_id] : []), ...memberIds]),
];
const names = nameIds.length
? await fetchDisplayNames(nameIds, "[project-page]")
: new Map<string, string>();
const leadName = project.project_lead_id ? (names.get(project.project_lead_id) ?? null) : null;
const memberNames = memberIds
.map((id) => names.get(id) ?? null)
.filter((n): n is string => n !== null);
const typeLabel = project.project_type ? PROJECT_TYPE_LABEL[project.project_type] : null;

const { data: workPackages } = await supabase
.from("work_packages")
.select("id, code, name, status, deliverable_id")
.eq("project_id", project.id)
.order("code", { ascending: true });

// Deliverables for the grouping headers (spec 11). RLS admits
// sa/pm/super SELECT (spec 04 Phase 1). Empty today — the list
// degrades to flat until spec 04 Phase 2 backfills the data.
const { data: deliverables } = await supabase
.from("deliverables")
.select("id, code, name, sort_order")
.eq("project_id", project.id)
.order("sort_order", { ascending: true });

return (
<PageShell>
<BottomTabBar role={ctx.role} />
{/_ Spec 63: the consolidated shell. Spec 82 Unit 3: back goes to the
single folded /projects hub (was the role-aware projectHubHref).
The spec-58/59 pm/super chips ride the actions slot — SA never
sees the gear; the settings page also requireRole-gates. _/}
<DetailHeader
backHref="/projects"
backLabel="กลับไปโครงการ"
actions={
ctx.role === "project_manager" || ctx.role === "super_admin" ? (
<>
<Link
                href={reportsHref(project.id)}
                aria-label="รายงานโครงการ"
                className={ICON_CHIP_MUTED}
              >
<FileText aria-hidden className="h-5 w-5" />
</Link>
<Link
                href={projectSettingsHref(project.id)}
                aria-label="ตั้งค่าโครงการ"
                className={ICON_CHIP_MUTED}
              >
<Settings aria-hidden className="h-5 w-5" />
</Link>
</>
) : null
} >
<div>
<p className="font-mono text-xs text-zinc-600">{project.code}</p>
<h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
{(clientName ||
leadName ||
memberNames.length > 0 ||
typeLabel ||
project.site_address) && (
<dl className="mt-1.5 flex flex-col gap-0.5 text-xs text-zinc-600">
{clientName && (
<div className="flex gap-1.5">
<dt>ลูกค้า:</dt>
<dd className="font-medium text-zinc-900">{clientName}</dd>
</div>
)}
{leadName && (
<div className="flex gap-1.5">
<dt>ผู้รับผิดชอบ:</dt>
<dd className="font-medium text-zinc-900">{leadName}</dd>
</div>
)}
{memberNames.length > 0 && (
<div className="flex gap-1.5">
<dt>ทีมงาน:</dt>
<dd className="font-medium break-words text-zinc-900">
{memberNames.join(", ")}
</dd>
</div>
)}
{typeLabel && (
<div className="flex gap-1.5">
<dt>ประเภท:</dt>
<dd className="font-medium text-zinc-900">{typeLabel}</dd>
</div>
)}
{project.site_address && (
<div className="flex gap-1.5">
<dt>ที่ตั้ง:</dt>
<dd className="font-medium break-words text-zinc-900">{project.site_address}</dd>
</div>
)}
</dl>
)}
</div>
</DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>รายการงาน</h2>
        <WorkPackageList
          projectId={project.id}
          workPackages={(workPackages ?? []).map((wp) => ({
            id: wp.id,
            code: wp.code,
            name: wp.name,
            status: wp.status,
            deliverableId: wp.deliverable_id,
          }))}
          deliverables={(deliverables ?? []).map((d) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            sortOrder: d.sort_order,
          }))}
        />
      </section>
    </PageShell>

);
}

===== FILE: src/app/projects/[projectId]/work-package-list.tsx =====

"use client";

// Client Component: status-view filter + deliverable grouping over an
// already-loaded WP list (~80 rows, all in-memory).
//
// Spec 56: the old search box + hide-completed checkbox are replaced by
// a four-view segmented control (งานค้าง default / รอตรวจ / เสร็จแล้ว /
// ทั้งหมด) — finished WPs are hidden by default, shown on request.
//
// Spec 11 grouping: when the project has deliverables, WPs render under
// per-deliverable headers that toggle show/hide (collapsed by default —
// the landing view is the deliverable overview with counts). Groups
// emptied by the view disappear (the pure helper never returns empty
// groups). With ZERO deliverables the list renders flat.
//
// Collapse state and the view are local client state — the URL stays
// stable, no server round-trip.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { workPackageHref } from "@/lib/nav/project-paths";
import { useMemo, useState } from "react";
import { EmptyNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { RadioChip } from "@/components/features/radio-chip";
import type { Database } from "@/lib/db/database.types";
import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";
import {
groupWorkPackagesByDeliverable,
type GroupDeliverable,
} from "@/lib/deliverables/group-work-packages";
import {
DEFAULT_WP_LIST_VIEW,
WP_LIST_VIEWS,
filterByView,
type WpListView,
} from "@/lib/work-packages/list-filter";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

const UNGROUPED_KEY = "**ungrouped**";

export interface WorkPackageListItem {
id: string;
code: string;
name: string;
status: WorkPackageStatus;
deliverableId: string | null;
}

interface WorkPackageListProps {
projectId: string;
workPackages: ReadonlyArray<WorkPackageListItem>;
deliverables: ReadonlyArray<GroupDeliverable>;
}

export function WorkPackageList({ projectId, workPackages, deliverables }: WorkPackageListProps) {
const [view, setView] = useState<WpListView>(DEFAULT_WP_LIST_VIEW);
// Keys of groups the user has opened (deliverable id, or UNGROUPED_KEY).
// Default empty = all collapsed.
const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

const filtered = useMemo(() => filterByView(workPackages, view), [workPackages, view]);

const groups = useMemo(
() => groupWorkPackagesByDeliverable(filtered, deliverables),
[filtered, deliverables],
);

// Header progress per group, derived from the UNFILTERED list (spec 12):
// the pill, k/n count, and progress strip describe the deliverable's
// true state even while query / hide-completed are hiding rows.
const progressByKey = useMemo(() => {
const map = new Map<string, ReturnType<typeof deriveDeliverableProgress>>();
for (const group of groupWorkPackagesByDeliverable(workPackages, deliverables)) {
map.set(
group.deliverable?.id ?? UNGROUPED_KEY,
deriveDeliverableProgress(group.workPackages.map((wp) => wp.status)),
);
}
return map;
}, [workPackages, deliverables]);

function toggleGroup(key: string) {
setExpanded((prev) => {
const next = new Set(prev);
if (next.has(key)) {
next.delete(key);
} else {
next.add(key);
}
return next;
});
}

// Empty-state copy: no WPs at all, every WP finished under the
// default outstanding view, or the chosen view has no matches.
const emptyMessage =
workPackages.length === 0
? "ยังไม่มีรายการงาน"
: view === "outstanding" && workPackages.every((wp) => wp.status === "complete")
? "รายการงานทั้งหมดเสร็จสิ้นแล้ว"
: "ไม่พบรายการงานที่ตรงกับเงื่อนไข";

// Two presentations (spec 40): a standalone card in flat mode, a
// contained divided row inside a deliverable group — the visual
// hierarchy the operator asked for (groups frame, rows belong).
const rowLink = (wp: WorkPackageListItem, contained = false) => (
<Link
href={workPackageHref(projectId, wp.id)}
className={
contained
? "flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-inset active:bg-zinc-100"
: "flex min-h-14 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 active:bg-zinc-100"
} >
<div className="min-w-0">
<p className="font-mono text-xs text-zinc-600">{wp.code}</p>
{/_ Spec 57: clamp-2, never single-line truncate — the name is
the row's information. _/}
<p className="line-clamp-2 text-base font-medium break-words text-zinc-900">{wp.name}</p>
</div>
<StatusPill pillClasses={workPackageStatusPillClasses(wp.status)}>
{WORK_PACKAGE_STATUS_LABEL[wp.status] ?? wp.status}
</StatusPill>
</Link>
);

return (
<div className="flex flex-col gap-4">
{/_ Spec 56: four-view segmented control (the spec-21 shape) —
replaces the search box + hide-completed checkbox. _/}
{/_ Spec 67: native-radio chips (RadioChip) — arrow-key + SR semantics
from the browser, 44px targets. Was a fake role="radio" on 36px
buttons. _/}
<div role="radiogroup" aria-label="กรองรายการงาน" className="flex flex-wrap gap-2">
{WP_LIST_VIEWS.map(({ value, label }) => (
<RadioChip
key={value}
name="wp-list-view"
label={label}
checked={view === value}
onSelect={() => setView(value)}
/>
))}
</div>

      {filtered.length === 0 ? (
        <EmptyNotice>{emptyMessage}</EmptyNotice>
      ) : deliverables.length === 0 ? (
        // Degraded mode (spec 11): no deliverables on the project yet —
        // flat list, exactly the pre-grouping behaviour.
        <ul className="flex flex-col gap-2">
          {filtered.map((wp) => (
            <li key={wp.id}>{rowLink(wp)}</li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const key = group.deliverable?.id ?? UNGROUPED_KEY;
            const isOpen = expanded.has(key);
            // Progress is derived from the FULL membership (spec 12) so the
            // header tells the truth while the text filter or
            // "Hide completed" is hiding rows below it.
            const progress =
              progressByKey.get(key) ??
              deriveDeliverableProgress(group.workPackages.map((wp) => wp.status));
            const groupName = group.deliverable?.name ?? "ยังไม่จัดกลุ่ม";
            const contentId = `wp-group-${key}`;
            return (
              <section
                key={key}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  className="flex min-h-12 w-full cursor-pointer flex-col gap-2 border-l-4 border-amber-400 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-inset active:bg-slate-200"
                >
                  <span className="flex w-full items-center gap-3">
                    <ChevronRight
                      aria-hidden
                      className={`size-4 shrink-0 text-zinc-600 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span className="min-w-0 flex-1">
                      {group.deliverable ? (
                        <>
                          <span className="font-mono text-xs font-semibold text-slate-500">
                            {group.deliverable.code}
                          </span>
                          {/* Spec 57/67: list headers line-clamp, never
                              single-line truncate (Thai clips mid-word). */}
                          <span className="line-clamp-2 block text-base font-bold tracking-tight break-words text-slate-900">
                            {group.deliverable.name}
                          </span>
                        </>
                      ) : (
                        <span className="line-clamp-2 block text-sm font-medium break-words text-zinc-600">
                          ยังไม่จัดกลุ่ม
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <StatusPill pillClasses={workPackageStatusPillClasses(progress.status)}>
                        {WORK_PACKAGE_STATUS_LABEL[progress.status]}
                      </StatusPill>
                      <span className="text-xs text-zinc-600">
                        {progress.completeCount}/{progress.totalCount} รายการ
                      </span>
                    </span>
                  </span>
                  <span
                    role="progressbar"
                    aria-valuenow={progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${groupName} — เสร็จแล้ว ${progress.percent}%`}
                    className="block h-1 w-full overflow-hidden rounded-full bg-zinc-200"
                  >
                    <span
                      className="block h-full rounded-full bg-emerald-600 transition-[width] motion-reduce:transition-none"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </span>
                </button>
                {isOpen ? (
                  <ul id={contentId} className="divide-y divide-zinc-100 border-t border-zinc-200">
                    {group.workPackages.map((wp) => (
                      <li key={wp.id}>{rowLink(wp, true)}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>

);
}

===== FILE: src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx =====

import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, DETAIL_TITLE } from "@/lib/ui/classes";
import { notFound } from "next/navigation";
import { Camera, FileText, ShoppingCart, Users } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { projectHref, workPackageHref } from "@/lib/nav/project-paths";
import { createClient } from "@/lib/db/server";
import { getCurrentPhotosForWorkPackage, type PhotoLogRow } from "@/lib/photos/current-photos";
import { latestCreatedAt, PHASES } from "@/lib/photos/phases";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { StatusPill } from "@/components/features/status-pill";
import { DetailHeader } from "@/components/features/detail-header";
import { PurchaseRequestCard } from "@/components/features/purchase-request-card";
import {
APPROVAL_DECISION_LABEL,
WORK_PACKAGE_STATUS_LABEL,
formatThaiDateTime,
formatThaiTime,
} from "@/lib/i18n/labels";
import { AttentionCard } from "@/components/features/attention-card";
import { CountChip } from "@/components/features/count-chip";
import { PhaseProgressBar } from "@/components/features/phase-progress-bar";
import {
approvalDecisionPillClasses,
workPackageStatusPillClasses,
type PurchaseRequestPriority,
type PurchaseRequestStatus,
} from "@/lib/status-colors";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { WpAssignmentPanel } from "@/components/features/wp-assignment-panel";
import { WorkPackageNotes } from "@/components/features/work-package-notes";
import { PurchaseRequestForm } from "@/components/features/purchase-request-form";
import { SitePurchaseForm } from "@/components/features/site-purchase-form";
import { LaborLogZone } from "@/components/features/labor-log-zone";
import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";
import { PhaseUploader } from "./phase-uploader";

interface PageProps {
params: Promise<{ projectId: string; workPackageId: string }>;
}

export const metadata = { title: "รูปถ่ายงาน" };

export default async function WorkPackagePhotoScreen({ params }: PageProps) {
const { projectId, workPackageId } = await params;
const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
const supabase = await createClient();

const { data: wp } = await supabase
.from("work_packages")
.select("id, code, name, status, project_id, description, contractor_id, notes")
.eq("id", workPackageId)
.maybeSingle();

if (!wp || wp.project_id !== projectId) {
notFound();
}

// Spec 31 / ADR 0033: WP owner = contractor entity (outsider crew).
// One read serves both the header line and the assignment picker.
const { data: contractorRows } = await supabase
.from("contractors")
.select("id, name, phone, status")
.order("name", { ascending: true });
const contractors = contractorRows ?? [];
const assignedContractor = wp.contractor_id
? (contractors.find((c) => c.id === wp.contractor_id) ?? null)
: null;
// Spec 89: blacklisted contractors are hidden from the assignment picker, but
// a WP already owned by a now-blacklisted contractor still lists its owner
// (never blank an existing assignment).
const pickerContractors = contractors
.filter((c) => c.status !== "blacklisted" || c.id === wp.contractor_id)
.map(({ id, name, phone }) => ({ id, name, phone }));

const { data: approvalRows } = await supabase
.from("approvals")
.select("id, decision, comment, decided_by, decided_at")
.eq("work_package_id", wp.id)
.order("decided_at", { ascending: false });
const approvals = approvalRows ?? [];
const latestDecision = approvals[0] ?? null;
const attention =
latestDecision &&
(latestDecision.decision === "needs_revision" || latestDecision.decision === "rejected")
? latestDecision
: null;

// Spec-31 amendment: every role this page admits may manage
// contractors (field staff included) — the RPC enforces server-side.
const isAssigner = true;

// Spec 25: this WP's purchase requests render inline — the operator's
// "delivery status must show inside each WP, not having to go to the
// request page." Same RLS-decided visibility as /requests. Spec 47
// amendment: rows render through PurchaseRequestCard (tap opens
// /requests/[id]), so the select carries the card's full prop set.
const { data: wpRequests } = await supabase
.from("purchase_requests")
.select(
"id, pr_number, item_description, quantity, unit, status, priority, requested_at, requested_by, requested_by_email, needed_by, decided_at, purchased_at, shipped_at, delivered_at, eta",
)
.eq("work_package_id", wp.id)
.order("requested_at", { ascending: false });

// One display-name lookup serves the approval history AND the request
// cards' requester lines.
const nameIds = Array.from(
new Set(
[
...approvals.map((a) => a.decided_by),
...(wpRequests ?? []).map((r) => r.requested_by),
].filter((id): id is string => typeof id === "string"),
),
);
const displayNames = await fetchDisplayNames(nameIds, "[wp-detail]");

// Spec 54: the chip counts rows actually waiting on a PM decision
// (mockup label คำขอซื้อรออนุมัติ) — replaces the old open-count line.
const requestedCount = (wpRequests ?? []).filter((r) => r.status === "requested").length;

// Spec 46: labor capture data (presence-only — the helper's explicit
// column lists are the app-layer half of the money posture).
const labor = await fetchLaborZoneData(supabase, wp.id);

const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
const allPhotos: PhotoLogRow[] = [
...photosByPhase.before,
...photosByPhase.during,
...photosByPhase.after,
];
const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

return (
<PageShell>
<BottomTabBar role={ctx.role} />
{/_ Spec 54 header (operator mockup) via the spec-63 shell; the
progress band below scrolls. _/}
<DetailHeader backHref={projectHref(projectId)} backLabel="กลับไปรายการงาน">
<div className="flex items-start justify-between gap-3">
<div className="min-w-0">
<p className="font-mono text-xs text-zinc-600">{wp.code}</p>
{/_ Spec 57: WP name never truncates — full wrap. _/}
<h1 className={DETAIL_TITLE}>{wp.name}</h1>
</div>
<StatusPill pillClasses={workPackageStatusPillClasses(wp.status)} className="mt-1">
{WORK_PACKAGE_STATUS_LABEL[wp.status as keyof typeof WORK_PACKAGE_STATUS_LABEL] ??
wp.status}
</StatusPill>
</div>
{assignedContractor ? (
<>
<p className="text-xs text-zinc-600">
ผู้รับเหมา{" "}
<span className="font-medium text-zinc-900">{assignedContractor.name}</span>
{assignedContractor.phone ? (
<>
<span className="mx-1 text-zinc-400">·</span>
<a href={`tel:${assignedContractor.phone}`} className="text-blue-700">
{assignedContractor.phone}
</a>
</>
) : null}
</p>
{/_ Re-assignment stays reachable once assigned — the
attention card (below) only carries the UNASSIGNED case. _/}
{isAssigner ? (
<WpAssignmentPanel
                projectId={wp.project_id}
                workPackageId={wp.id}
                contractors={pickerContractors}
                contractorId={wp.contractor_id}
              />
) : null}
</>
) : null}
</DetailHeader>

      <div className="border-b border-zinc-200 bg-white px-5 py-3">
        <div className={`mx-auto ${PAGE_MAX_W}`}>
          <PhaseProgressBar
            counts={{
              before: photosByPhase.before.length,
              during: photosByPhase.during.length,
              after: photosByPhase.after.length,
            }}
          />
        </div>
      </div>

      {/* Spec 54 attention stack: PM decision feedback, the unassigned-
          contractor card (mockup), and the pending-requests chip. */}
      {attention || !assignedContractor || requestedCount > 0 ? (
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3 px-5 pt-5`}>
          {attention ? (
            <AttentionCard
              tone={attention.decision === "rejected" ? "red" : "amber"}
              title={APPROVAL_DECISION_LABEL[attention.decision]}
            >
              <p className="text-xs text-zinc-600">
                {displayNames.get(attention.decided_by) ?? "—"} ·{" "}
                {formatThaiDateTime(attention.decided_at)}
              </p>
              {attention.comment ? (
                <p className="mt-1 whitespace-pre-wrap">{attention.comment}</p>
              ) : null}
            </AttentionCard>
          ) : null}
          {!assignedContractor && isAssigner ? (
            <AttentionCard tone="amber" title="ต้องมอบหมายผู้รับเหมาก่อนเริ่มงาน">
              <p>งานนี้ยังไม่มีผู้รับเหมา — เลือกจากรายชื่อ หรือเพิ่มใหม่</p>
              <div className="mt-2">
                <WpAssignmentPanel
                  projectId={wp.project_id}
                  workPackageId={wp.id}
                  contractors={contractors}
                  contractorId={wp.contractor_id}
                />
              </div>
            </AttentionCard>
          ) : null}
          <CountChip count={requestedCount} label="คำขอซื้อรออนุมัติ" href="#wp-requests" />
        </div>
      ) : null}

      {/* Spec 28 Part C: single column on phones (photos first — the
          SA's job); ≥md two columns — photos wide left, facts right.
          max width steps up to 4xl ONLY at md so phones keep the
          familiar 2xl measure. */}
      <div
        className={`mx-auto grid ${PAGE_MAX_W} grid-cols-1 gap-6 px-5 py-6 md:grid-cols-[1.6fr_1fr] md:items-start lg:gap-8`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          {/* Spec 30: zone headers — icon + bold title + rule line so the
              three content categories read as distinct at a glance. */}
          <h2 className="flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <Camera aria-hidden className="size-5 text-blue-700" />
            รูปถ่ายงาน
          </h2>
          {PHASES.map(({ phase, label }) => {
            const rows = photosByPhase[phase];
            // Spec 54: tile overlay = capture time (client clock when
            // known, else upload time); sub-line = latest upload time.
            const latest = latestCreatedAt(rows);
            return (
              <PhaseUploader
                key={phase}
                projectId={wp.project_id}
                workPackageId={wp.id}
                userId={ctx.id}
                phase={phase}
                label={label}
                photos={rows.map((p) => ({
                  id: p.id,
                  url: signedUrls.get(p.id) ?? null,
                  timeLabel: formatThaiTime(p.captured_at_client ?? p.created_at),
                }))}
                lastUpdatedLabel={latest ? formatThaiTime(latest) : null}
              />
            );
          })}

          {/* Spec 46: daily crew presence. Field UI is presence-only —
              rates/costs never reach this page (C3 column grants). */}
          <h2 className="mt-2 flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <Users aria-hidden className="size-5 text-blue-700" />
            บันทึกแรงงานรายวัน
          </h2>
          <LaborLogZone
            workPackageId={wp.id}
            revalidate={workPackageHref(projectId, workPackageId)}
            roster={labor.roster}
            rows={labor.rows}
            showFlags={ctx.role !== "site_admin"}
            locked={wp.status === "complete"}
          />
        </div>

        <div id="wp-requests" className="flex min-w-0 scroll-mt-4 flex-col gap-4">
          <h2 className="flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <ShoppingCart aria-hidden className="size-5 text-blue-700" />
            คำขอซื้อ
          </h2>
          {/* Spec 29: the create form lives HERE now — raising a request
              no longer teleports the user to the คำขอซื้อ tab
              (operator-reported disorientation; site map 2026-06-11).
              The PM WP review screen (/review/work-packages/[workPackageId])
              is the remaining in-app producer of /requests?wp= pinned
              mode. */}
          <details className={CARD}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
              สร้างคำขอซื้อ
            </summary>
            <div className="mt-3">
              <PurchaseRequestForm
                workPackage={{ id: wp.id, code: wp.code, name: wp.name }}
                projectId={wp.project_id}
                userId={ctx.id}
              />
            </div>
          </details>
          {/* Spec 66 / ADR 0043: log a cash purchase made on site (no
              request→approve) and attach its receipt right here. */}
          <details className={CARD}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
              บันทึกการซื้อหน้างาน
            </summary>
            <div className="mt-3">
              <SitePurchaseForm workPackageId={wp.id} projectId={wp.project_id} />
            </div>
          </details>
          {(wpRequests ?? []).length > 0 ? (
            <section>
              {/* Spec 47 amendment (operator: "this is from WP detail
                  page"): the same slim card as /requests — tap opens the
                  order detail screen. WP line omitted; this zone IS the
                  WP context. */}
              <ul className="flex flex-col gap-2">
                {(wpRequests ?? []).map((r) => (
                  <li key={r.id}>
                    <PurchaseRequestCard
                      request={{
                        id: r.id,
                        pr_number: r.pr_number,
                        item_description: r.item_description,
                        quantity: r.quantity,
                        unit: r.unit,
                        status: r.status as PurchaseRequestStatus,
                        priority: r.priority as PurchaseRequestPriority,
                        requested_at: r.requested_at,
                        needed_by: r.needed_by,
                        decided_at: r.decided_at,
                        purchased_at: r.purchased_at,
                        shipped_at: r.shipped_at,
                        delivered_at: r.delivered_at,
                        eta: r.eta,
                      }}
                      workPackage={null}
                      requesterName={
                        (r.requested_by ? displayNames.get(r.requested_by) : null) ??
                        r.requested_by_email ??
                        null
                      }
                      isMine={r.requested_by === ctx.id}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <h2 className="mt-2 flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <FileText aria-hidden className="size-5 text-blue-700" />
            ข้อมูลงาน
          </h2>
          {/* Spec 71: editable backup-capture note — the catch-all for
              anything the structured fields don't cover. */}
          <div className={CARD}>
            <WorkPackageNotes projectId={wp.project_id} workPackageId={wp.id} notes={wp.notes} />
          </div>
          {wp.description ? (
            <details className={CARD}>
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
                รายละเอียดงาน
              </summary>
              <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-700">{wp.description}</p>
            </details>
          ) : null}
          {approvals.length > 0 ? (
            <details className={CARD}>
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
                ประวัติการตรวจ ({approvals.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {approvals.map((a) => (
                  <li key={a.id} className="border-t border-zinc-200 pt-2 first:border-t-0">
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill pillClasses={approvalDecisionPillClasses(a.decision)}>
                        {APPROVAL_DECISION_LABEL[a.decision]}
                      </StatusPill>
                      <span className="text-xs text-zinc-600">
                        {displayNames.get(a.decided_by) ?? "—"} · {formatThaiDateTime(a.decided_at)}
                      </span>
                    </div>
                    {a.comment ? (
                      <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-700">{a.comment}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </PageShell>

);
}

===== FILE: src/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader.tsx =====

"use client";

import { INLINE_ERROR } from "@/lib/ui/classes";

// Client-side per-phase upload + remove UI for the photo screen.
//
// File bytes go DIRECT from the browser to Supabase Storage under
// the user's session (the bucket INSERT policy admits sa/pm/super).
// Only metadata then flows to the addPhoto server action, which
// records the row + runs the conditional pending_approval transition.
//
// Per-photo lifecycle visible to the user:
// uploading → inserting → done (refresh)
// uploading → upload-error (retry re-uploads with the same uuid)
// inserting → insert-error (retry calls addPhoto only; object is
// already in Storage so no re-upload is needed)
//
// Spec 35: every selected photo ALSO persists to the offline queue at
// selection — error states are no longer terminal; the global
// UploadQueueRunner retries leftovers (idempotently) independent of
// this UI, including after a crash, offline failure, or navigation.

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Camera, Check } from "lucide-react";
import { createClient as createBrowserSupabase } from "@/lib/db/browser";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photo-strip";
import {
photoExtToMime,
type PhotoExt,
buildPhotoStoragePath,
PHOTO_ACCEPT_MIME,
} from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import {
classifyStorageUploadError,
queueNowMs,
type QueuedUpload,
} from "@/lib/photos/upload-queue";
import { notifyQueueChanged, safeQueuePut, safeQueueRemove } from "@/lib/photos/upload-queue-idb";
import type { PhotoPhase } from "@/lib/photos/transitions";
import { addPhoto, removePhoto } from "./actions";

const PHOTOS_BUCKET = "photos";

interface ThumbnailPhoto {
id: string;
url: string | null;
/\*_ HH:MM capture-time overlay (spec 54) — null hides the overlay. _/
timeLabel: string | null;
}

type UploadStatus = "uploading" | "uploaded" | "inserting" | "upload-error" | "insert-error";

interface PendingUpload {
id: string;
fileName: string;
previewUrl: string;
status: UploadStatus;
errorMessage: string | null;
// Stored so retry can rebuild the upload OR replay just the insert.
// `blob` is the PREPARED bytes (spec 34 downscale) — retries must not
// re-decode; no raw File survives in state (spec 34 checklist), only
// the lastModified scalar for capturedAtClient.
blob: Blob;
lastModifiedMs: number;
/\*_ Queue ordering timestamp, captured once at selection (spec 35). _/
enqueuedAtMs: number;
ext: PhotoExt;
storagePath: string;
}

interface PhaseUploaderProps {
projectId: string;
workPackageId: string;
/** Session user — stamped on queue items (ADR 0039 attribution guard). \*/
userId: string;
phase: PhotoPhase;
label: string;
photos: ReadonlyArray<ThumbnailPhoto>;
/** Latest upload time, HH:MM (spec 54 timeline sub-line); null = none. \*/
lastUpdatedLabel: string | null;
}

export function PhaseUploader({
projectId,
workPackageId,
userId,
phase,
label,
photos,
lastUpdatedLabel,
}: PhaseUploaderProps) {
const router = useRouter();
const fileInputRef = useRef<HTMLInputElement>(null);
const [pending, setPending] = useState<ReadonlyArray<PendingUpload>>([]);
const [topLevelError, setTopLevelError] = useState<string | null>(null);
const [removingId, setRemovingId] = useState<string | null>(null);
// Photo id awaiting removal confirmation in the themed dialog
// (replaces window.confirm — spec 18).
const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
const [, startTransition] = useTransition();

function updatePending(id: string, patch: Partial<PendingUpload>) {
setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

function removePending(id: string) {
setPending((prev) => {
const target = prev.find((p) => p.id === id);
if (target) URL.revokeObjectURL(target.previewUrl);
return prev.filter((p) => p.id !== id);
});
}

// Spec 35 / ADR 0039: the live pipeline is bracketed by the offline
// queue — put at selection, step-advance after bytes land, remove
// after the metadata row lands. A crash/offline/navigation at any
// point leaves a queue item the global runner resumes (idempotently).
function toQueueItem(upload: PendingUpload): QueuedUpload {
return {
kind: "phase_photo",
id: upload.id,
userId,
workPackageId,
phase,
ext: upload.ext,
blob: upload.blob,
lastModifiedMs: upload.lastModifiedMs,
fileName: upload.fileName,
storagePath: upload.storagePath,
step: "upload",
attempts: 0,
lastError: null,
enqueuedAtMs: upload.enqueuedAtMs,
};
}

async function uploadOne(upload: PendingUpload) {
const supabase = createBrowserSupabase();
const { error: uploadError } = await supabase.storage
.from(PHOTOS_BUCKET)
.upload(upload.storagePath, upload.blob, {
contentType: photoExtToMime(upload.ext),
upsert: false,
});
if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
// Fixed Thai on the tile; the raw SDK message (English) goes to
// the console only (spec 15 item F). The queue item stays —
// the runner will retry it even if the user leaves this page.
console.error("[phase-uploader] storage upload failed", uploadError.message);
notifyQueueChanged();
updatePending(upload.id, {
status: "upload-error",
errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
});
return;
}
// Bytes landed (now, or earlier by the runner — a 409 duplicate is
// OUR object under this uuid path, ADR 0039 idempotency). Persist
// the step advance so a recovery pass never re-uploads.
await safeQueuePut({ ...toQueueItem(upload), step: "insert" });
updatePending(upload.id, { status: "uploaded" });
await insertOne({ ...upload, status: "uploaded" });
}

async function insertOne(upload: PendingUpload) {
updatePending(upload.id, { status: "inserting" });
let result: Awaited<ReturnType<typeof addPhoto>>;
try {
result = await addPhoto({
workPackageId,
phase,
photoId: upload.id,
ext: upload.ext,
capturedAtClient: new Date(upload.lastModifiedMs).toISOString(),
});
} catch (err) {
// The action INVOCATION failed (connectivity dropped between the
// bytes landing and this POST — the flaky-signal target case).
// The queue item (step=insert) survives for the runner.
console.error("[phase-uploader] addPhoto invocation failed", err);
result = { ok: false, error: "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
}
if (!result.ok) {
// Queue item stays (step=insert) — the runner replays the action.
notifyQueueChanged();
updatePending(upload.id, {
status: "insert-error",
errorMessage: `อัปโหลดสำเร็จแต่บันทึกข้อมูลไม่สำเร็จ — ${result.error}`,
});
return;
}
// Fully landed — release the queue item (and let the runner's
// banner refresh), drop the pending tile; the refreshed server
// data will surface the real thumbnail.
await safeQueueRemove(upload.id);
notifyQueueChanged();
removePending(upload.id);
startTransition(() => router.refresh());
}

async function handleFiles(files: FileList | null) {
if (!files || files.length === 0) return;
setTopLevelError(null);

    // Sequential uploads — easier to reason about per-photo status
    // than parallel; spec accepts either.
    for (const file of Array.from(files)) {
      // Spec 34 / ADR 0036: downscale before upload — the prepared blob
      // IS the original we store. Failure paths inside return the file
      // unchanged; null = non-photo MIME (the existing rejection).
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) {
        setTopLevelError(
          `ไฟล์ "${file.name}" ไม่ใช่รูปภาพที่รองรับ — ใช้ JPEG, PNG, WebP หรือ HEIC`,
        );
        continue;
      }
      const id = crypto.randomUUID();
      const upload: PendingUpload = {
        id,
        fileName: file.name,
        previewUrl: URL.createObjectURL(prepared.blob),
        status: "uploading",
        errorMessage: null,
        blob: prepared.blob,
        lastModifiedMs: file.lastModified,
        enqueuedAtMs: queueNowMs(),
        ext: prepared.ext,
        storagePath: buildPhotoStoragePath(projectId, workPackageId, id, prepared.ext),
      };
      setPending((prev) => [...prev, upload]);
      try {
        // Persist BEFORE attempting — from here the photo survives a
        // crash, an offline failure, or leaving the page (spec 35).
        await safeQueuePut(toQueueItem(upload));
        await uploadOne(upload);
      } catch (err) {
        // One photo's unexpected failure must never abort the loop —
        // the remaining selected files still get queued and uploaded.
        console.error("[phase-uploader] unexpected per-file failure", err);
        updatePending(upload.id, {
          status: "upload-error",
          errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        });
        notifyQueueChanged();
      }
    }

    // Allow re-selecting the same file (e.g. after a Retry that fully
    // resolved, then the user wants to add it again).
    if (fileInputRef.current) fileInputRef.current.value = "";

}

async function retry(uploadId: string) {
const upload = pending.find((p) => p.id === uploadId);
if (!upload) return;
if (upload.status === "upload-error") {
updatePending(uploadId, { status: "uploading", errorMessage: null });
await uploadOne(upload);
} else if (upload.status === "insert-error") {
// Object is already in Storage; just replay the insert.
updatePending(uploadId, { status: "inserting", errorMessage: null });
await insertOne(upload);
}
}

async function handleRemoveConfirmed(photoId: string) {
// Always close the dialog; then serialize removals — while one
// removal's server action is in flight, confirming another is a
// no-op (deliberate: one tombstone round-trip at a time).
setConfirmRemoveId(null);
if (removingId !== null) return;
setRemovingId(photoId);
const result = await removePhoto({ photoLogId: photoId });
setRemovingId(null);
if (!result.ok) {
setTopLevelError(result.error);
return;
}
startTransition(() => router.refresh());
}

const hasPhotos = photos.length > 0;

// Spec 50: the loaded photos of THIS phase form one lightbox group —
// swipe stays inside the strip the user tapped. Missing-URL and
// pending tiles are not members. Spec 51: ids ride along, aligned
// with the urls, so the lightbox can attach markup to the photo
// actually shown after navigation.
const loadedUrls = photos.flatMap((p) => (p.url !== null ? [p.url] : []));
const loadedPhotoIds = photos.flatMap((p) => (p.url !== null ? [p.id] : []));
const loadedIndexById = new Map<string, number>();
{
let i = 0;
for (const p of photos) if (p.url !== null) loadedIndexById.set(p.id, i++);
}

return (
/_ Spec 54 timeline row: status disc + label/count header, then the
rail-indented body (sub-line + strip). The upload machinery below
is byte-equivalent to the pre-54 version — only the trigger moved
into the strip's first tile. _/
<section>
<div className="mb-1.5 flex items-center gap-3">
{hasPhotos ? (
<span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
<Check aria-hidden className="h-4 w-4" strokeWidth={3} />
</span>
) : (
<span
            aria-hidden
            className="h-7 w-7 shrink-0 rounded-full border-2 border-zinc-300 bg-white"
          />
)}
<h2 className="text-base font-bold text-zinc-900">
{label}
{hasPhotos ? (
/_ Spec 49: the strip hides its tail — announce the total. _/
<span className="ml-1.5 text-sm font-normal text-zinc-600">{photos.length} รูป</span>
) : null}
</h2>
</div>

      <div
        className={`ml-[13px] flex flex-col gap-2 border-l-2 pb-1 pl-5 ${
          hasPhotos ? "border-emerald-600" : "border-zinc-200"
        }`}
      >
        <p className="text-sm text-zinc-600">
          {lastUpdatedLabel ? `อัปเดตล่าสุด ${lastUpdatedLabel}` : "ยังไม่มีรูป"}
        </p>

        {topLevelError && (
          <div role="alert" className={INLINE_ERROR}>
            {topLevelError}
          </div>
        )}

        {/* Spec 49 filmstrip; spec 54 puts the add-photo tile FIRST so
            the strip is never empty and the affordance reads as "next
            photo goes here" (mockup ถ่ายเพิ่ม tile). */}
        <PhotoStrip>
          <li className="relative h-28 w-28 shrink-0 snap-start rounded-lg border-2 border-dashed border-zinc-300 bg-white">
            <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg transition-colors focus-within:ring-2 focus-within:ring-blue-700 hover:bg-zinc-50">
              <Camera aria-hidden className="h-6 w-6 text-zinc-500" />
              <span className="text-sm font-medium text-blue-700">ถ่ายเพิ่ม</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={PHOTO_ACCEPT_MIME}
                multiple
                className="sr-only"
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </label>
          </li>
          {photos.map((p) => (
            <Thumbnail
              key={p.id}
              photo={p}
              group={loadedUrls}
              groupPhotoIds={loadedPhotoIds}
              groupIndex={loadedIndexById.get(p.id) ?? 0}
              isRemoving={removingId === p.id}
              onRemove={() => setConfirmRemoveId(p.id)}
            />
          ))}
          {pending.map((up) => (
            <PendingTile key={up.id} upload={up} onRetry={() => void retry(up.id)} />
          ))}
        </PhotoStrip>
      </div>

      <ConfirmDialog
        open={confirmRemoveId !== null}
        message={"ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้"}
        confirmLabel="ลบรูป"
        onConfirm={() => {
          if (confirmRemoveId) void handleRemoveConfirmed(confirmRemoveId);
        }}
        onCancel={() => setConfirmRemoveId(null)}
      />
    </section>

);
}

interface ThumbnailProps {
photo: ThumbnailPhoto;
group: ReadonlyArray<string>;
groupPhotoIds: ReadonlyArray<string>;
groupIndex: number;
isRemoving: boolean;
onRemove: () => void;
}

function Thumbnail({
photo,
group,
groupPhotoIds,
groupIndex,
isRemoving,
onRemove,
}: ThumbnailProps) {
return (
<li className={PHOTO_STRIP_TILE}>
{photo.url ? (
<ZoomablePhoto
          src={photo.url}
          group={group}
          groupPhotoIds={groupPhotoIds}
          groupIndex={groupIndex}
          photoId={photo.id}
        />
) : (
<div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
ไม่พร้อมแสดง
</div>
)}
{/_ Spec 54: capture-time overlay (mockup 09:12 tiles).
pointer-events-none — taps fall through to the lightbox. _/}
{photo.timeLabel ? (
<span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
{photo.timeLabel}
</span>
) : null}
{/_ Spec 36 tap-target pass: the BUTTON is a 44px transparent
square (real hit area, inside the tile so the li's
overflow-hidden cannot clip it); the red disc stays 28px
visually. Spinner gets the white variant — the default dark
track was ~1.8:1 on this red fill. _/}
<button
        type="button"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label="ลบรูป"
        className="group absolute top-0 right-0 inline-flex h-11 w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50"
      >
<span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-700 bg-red-600 font-semibold text-white transition-colors group-hover:bg-red-700">
{isRemoving ? (
<Spinner className="border-white/40 border-t-white" />
) : (
<span aria-hidden="true" className="text-base leading-none">
×
</span>
)}
</span>
</button>
</li>
);
}

interface PendingTileProps {
upload: PendingUpload;
onRetry: () => void;
}

function PendingTile({ upload, onRetry }: PendingTileProps) {
const isError = upload.status === "upload-error" || upload.status === "insert-error";
const inProgress = upload.status === "uploading" || upload.status === "inserting";
return (
<li className={PHOTO_STRIP_TILE}>
{/_ eslint-disable-next-line @next/next/no-img-element _/}
<img src={upload.previewUrl} alt="" className="h-full w-full object-cover opacity-50" />
<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center">
{inProgress && (
<>
<Spinner />
{/_ White plate keeps the label readable over DARK photos —
the ink sits on the plate, not the dimmed image. _/}
<span className="rounded bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-zinc-900">
{upload.status === "uploading" ? "กำลังอัปโหลด…" : "กำลังบันทึก…"}
</span>
</>
)}
{isError && (
<>
<span className="rounded bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-red-900">
{upload.errorMessage ?? "ล้มเหลว"}
</span>
{/_ Spec 36 tap-target pass: 44px min height for gloved hands. _/}
<button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center rounded border border-zinc-400 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
ลองใหม่
</button>
</>
)}
</div>
</li>
);
}

// Spec 36: track colors are overridable — the default dark track was
// ~1.8:1 against the red remove button; that call site passes a white
// variant.
function Spinner({ className }: { className?: string }) {
return (
<span
aria-hidden="true"
className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 ${
        className ?? "border-zinc-400 border-t-zinc-900"
      }`}
/>
);
}
