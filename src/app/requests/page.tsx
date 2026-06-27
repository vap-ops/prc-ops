import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { AppHeader } from "@/components/features/chrome/app-header";
import {
  HubNav,
  PM_HUB_NAV,
  SA_HUB_NAV,
  PROCUREMENT_HUB_NAV,
} from "@/components/features/chrome/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { PURCHASING_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PR_LIST_COLUMNS } from "@/lib/purchasing/columns";

// /requests — THE purchasing worklist for every role (spec 19 §4 merged
// the PM decision queue here; spec 16 A1 / ADR 0026 made the list
// site-wide). Requests are CREATED on the work-package page (spec 29 +
// spec 136), never here. Authorized: site_admin, project_manager,
// super_admin + procurement (the processor — ADR 0022 / spec 70).
//
// Server-side fetch: ALL visible purchase_requests — RLS decides
// (site_admin/PM/procurement/super see every row since ADR 0026; the
// own-row branch remains for future narrower roles). The ?mine=1 chip
// narrows back to the caller's own rows.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { comparePendingRequests } from "@/lib/purchasing/pending-order";
import {
  groupRequestsByBand,
  parseRequestView,
  REQUEST_VIEWS,
  REQUEST_VIEW_LABEL,
  type RequestView,
} from "@/lib/purchasing/request-bands";
import {
  groupByProcurementBand,
  procurementSummary,
  procurementBand,
  sumOutstanding,
  PROCUREMENT_BANDS,
  type ProcurementBand,
} from "@/lib/purchasing/procurement-pipeline";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { PurchaseRequestCard } from "@/components/features/purchasing/purchase-request-card";
import {
  ProcurementGrid,
  type ProcurementGridRecord,
} from "@/components/features/purchasing/procurement-grid";
import { PhonePoBasket } from "@/components/features/purchasing/phone-po-basket";
import { PoGroupCard } from "@/components/features/purchasing/po-group-card";
import { groupByPurchaseOrder } from "@/lib/purchasing/po-grouping";
import { buildPoDetailView } from "@/lib/purchasing/po-detail";
import { selectOverdueFollowUp } from "@/lib/purchasing/overdue-attention";
import { OverdueFollowUpPanel } from "@/components/features/purchasing/overdue-follow-up-panel";
import { buildWorklistKpis } from "@/lib/purchasing/worklist-kpis";
import { WorklistKpiTile } from "@/components/features/purchasing/worklist-kpi-tile";
import { buildWorklistStatusChips } from "@/lib/purchasing/worklist-status-chips";
import { WorklistStatusChips } from "@/components/features/purchasing/worklist-status-chips";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import type { SupplierOption } from "@/components/features/purchasing/purchase-record-form";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { ProcurementFilters } from "@/components/features/purchasing/procurement-filters";
import {
  matchesProcurementFilter,
  sortByPriority,
  distinctSuppliers,
  distinctProjects,
  buildWorklistQuery,
  type ProcurementFilter,
} from "@/lib/purchasing/worklist-filter";
import { PURCHASE_REQUEST_STATUS_LABEL } from "@/lib/i18n/labels";
import { bahtCompact as baht } from "@/lib/format";
import type { Database } from "@/lib/db/database.types";

// Spec 19 §4: the single purchasing surface for every role. The list is
// pending-first (priority band then requested asc — spec-16 A2), decided
// rows below newest-first; site-wide for every role since spec-16
// addendum A1 / ADR 0026. Spec 47: each row is a slim card linking to
// /requests/[id] — facts and every action zone (decision, recording,
// shipping, cancel, attachments) render on the detail screen.
export const metadata = { title: "จัดซื้อ" };

interface RequestsPageProps {
  searchParams: Promise<{
    mine?: string | string[];
    // Spec 137: site worklist action-state view (active | done | all).
    view?: string | string[];
    // Spec 110: procurement worklist filters.
    supplier?: string | string[];
    project?: string | string[];
    status?: string | string[];
    overdue?: string | string[];
    // Spec 138 U3: the status-chip band filter (to_order | in_transit | ...).
    band?: string | string[];
  }>;
}

// A single search-param value or undefined (params may repeat → string[]).
function singleParam(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];
const PR_STATUSES = new Set<string>(
  Object.keys(PURCHASE_REQUEST_STATUS_LABEL) as PurchaseRequestStatus[],
);
// Spec 138 U3: valid band-filter keys (a hand-edited ?band= outside this set is dropped).
const PROCUREMENT_BAND_KEYS = new Set<string>(PROCUREMENT_BANDS.map((b) => b.band));

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const supabase = await createClient();

  const {
    mine: mineParam,
    view: viewParam,
    supplier: supplierParam,
    project: projectParam,
    status: statusParam,
    overdue: overdueParam,
    band: bandParam,
  } = await searchParams;

  // Spec 110: parse the worklist filter (procurement only — SA/PM ignore it).
  // An unknown status/band value is dropped (treated as "all") so a hand-edited
  // URL can't pass garbage to the filter.
  const statusParamValue = singleParam(statusParam);
  const bandParamValue = singleParam(bandParam);
  const filter: ProcurementFilter = {
    supplier: singleParam(supplierParam),
    projectId: singleParam(projectParam),
    overdue: singleParam(overdueParam) === "1",
    status:
      statusParamValue !== null && PR_STATUSES.has(statusParamValue)
        ? (statusParamValue as PurchaseRequestStatus)
        : null,
    // Spec 138 U3: the status-chip band axis.
    band:
      bandParamValue !== null && PROCUREMENT_BAND_KEYS.has(bandParamValue)
        ? (bandParamValue as ProcurementBand)
        : null,
  };

  // Bare /requests is a PRIMARY TAB: like /review and /projects it carries the
  // desktop HubNav strip (the role's tab set) — NOT a back-bar. Spec 101 gives
  // procurement its own strip (worklist + suppliers + settings). The contextual
  // spec-12 back-bar (below) only renders when pinned — arriving from a WP to
  // raise a request is a drill-down, so it returns to that WP.
  const hubItems = isManagerRole(ctx.role)
    ? PM_HUB_NAV
    : ctx.role === "site_admin"
      ? SA_HUB_NAV
      : ctx.role === "procurement"
        ? PROCUREMENT_HUB_NAV
        : null;

  // The SELECT policy (ADR 0022, widened by ADR 0026) admits the whole
  // row, so the decision + back-office fact columns are readable here.
  // The PM's rejection comment is mandatory at the DB layer
  // (pr_reject_has_comment); purchased_at / supplier / delivered_at /
  // received_by / delivery_note are written by procurement in AppSheet
  // (ADR 0025) and are null until that stage.
  // RLS decides visibility (site-wide for sa/pm/procurement/super since
  // ADR 0026; the own-row branch remains for future narrower roles) —
  // no .eq(requested_by) filter since the spec-19 merge: PMs decide
  // here now.
  // ของฉัน filter chip (spec 16 A1): ?mine=1 narrows to the caller's own rows.
  const mineOnly = mineParam === "1";

  // Data-arch rank 8: bounded queries, not one unbounded fetch filtered in JS.
  // The old `select * order by requested_at` silently truncated at PostgREST's
  // 1000-row cap and applied ?mine AFTER it, so a user's own rows past row 1000
  // vanished. Split by band, each ordered in SQL via
  // purchase_requests_status_requested_at_idx, ?mine as a DB predicate so it is
  // correct at any scale:
  //   - pending (status='requested'): the actionable set, naturally small —
  //     fetched whole, then priority-band sorted in JS (critical → urgent →
  //     normal, oldest-first; comparePendingRequests, pinned by unit test).
  //   - decided (everything else): the unbounded-growth history — newest-first,
  //     bounded EXPLICITLY at PR_DECIDED_LIMIT (a documented cap, not a silent
  //     one). Raising it / adding keyset paging is the next step if needed.
  const PR_DECIDED_LIMIT = 500;

  let pendingQuery = supabase
    .from("purchase_requests")
    .select(`${PR_LIST_COLUMNS}, notes`)
    .eq("status", "requested");
  if (mineOnly) pendingQuery = pendingQuery.eq("requested_by", ctx.id);

  let decidedFilter = supabase
    .from("purchase_requests")
    .select(`${PR_LIST_COLUMNS}, notes`)
    .neq("status", "requested");
  if (mineOnly) decidedFilter = decidedFilter.eq("requested_by", ctx.id);
  const decidedQuery = decidedFilter
    .order("requested_at", { ascending: false })
    .limit(PR_DECIDED_LIMIT);

  const [pendingRes, decidedRes] = await Promise.all([pendingQuery, decidedQuery]);
  const myError = pendingRes.error ?? decidedRes.error;

  const pendingRows = (pendingRes.data ?? []).slice().sort(comparePendingRequests);
  const decidedRows = decidedRes.data ?? [];
  const myRequests = [...pendingRows, ...decidedRows];

  // Spec 137: the site list (non-procurement) groups into action-state bands; the view
  // filter (active default) hides received/closed — the operator's "filter out received".
  const requestView = parseRequestView(singleParam(viewParam));
  // Build a /requests URL preserving the other filter axis; omit defaults (view=active,
  // mine off) for clean links.
  const reqHref = (next: { view?: RequestView; mine?: boolean }): string => {
    const v = next.view ?? requestView;
    const m = next.mine ?? mineOnly;
    const params = new URLSearchParams();
    if (v !== "active") params.set("view", v);
    if (m) params.set("mine", "1");
    const qs = params.toString();
    return qs ? `/requests?${qs}` : "/requests";
  };

  // Site-wide visibility (A1): every viewer sees requester names now —
  // the operator-sanctioned name exposure recorded in ADR 0026.
  const requesterNames = await fetchDisplayNames(
    Array.from(
      new Set(
        myRequests.map((r) => r.requested_by).filter((id): id is string => typeof id === "string"),
      ),
    ),
    "[requests]",
  );

  // Resolve WP code/name for the list. PostgREST's foreign-table
  // inflection would also work, but a separate query mirrors the
  // pm/page.tsx + current-photos.ts convention and keeps the typed shape
  // legible to readers.
  // Spec 195 P1: a PR's work package is optional — drop null ids before the WP
  // lookup (a null in the `.in(...)` list matches nothing and is noise).
  const wpIdsInRequests = Array.from(
    new Set(myRequests.map((r) => r.work_package_id).filter((id): id is string => id !== null)),
  );
  const { data: wpForRequests } = await supabase
    .from("work_packages")
    .select("id, code, name, project_id")
    .in("id", wpIdsInRequests);
  const wpById = new Map((wpForRequests ?? []).map((wp) => [wp.id, wp]));
  // A WP-less PR (null work_package_id) is project-level / store-bound.
  const wpFor = (id: string | null) => (id ? wpById.get(id) : undefined);

  const isProcurement = ctx.role === "procurement";
  const today = bangkokTodayISO();

  // Spec 137: the site list groups into action-state bands; the view filter (active
  // default) hides received/closed. `today` flags overdue arrivals (the chase signal).
  const requestBands = groupRequestsByBand(myRequests, requestView, today);

  // Spec 110: project names for the project filter (procurement reads projects
  // read-only since spec 102 — RLS admits it, no migration). Procurement-only.
  const projectNameById = new Map<string, string>();
  if (isProcurement) {
    // Spec 195 P1: resolve names from the PR's own project_id (covers WP-less
    // PRs, whose project is not in the WP lookup above).
    const projectIds = Array.from(new Set(myRequests.map((r) => r.project_id)));
    if (projectIds.length > 0) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", projectIds);
      for (const p of projectRows ?? []) projectNameById.set(p.id, p.name);
    }
  }
  // Spec 110: filter picker options come from the UNFILTERED set so the filter
  // can always be changed.
  const supplierOptions = isProcurement ? distinctSuppliers(myRequests) : [];
  const projectOptions = isProcurement
    ? distinctProjects(
        myRequests.map((r) => {
          const pid = r.project_id;
          return { projectId: pid, projectName: pid ? (projectNameById.get(pid) ?? null) : null };
        }),
      )
    : [];

  // Spec 110: apply the filter, then group. Bands segment stage (spec 104); the
  // status filter overrides banding with a single flat group so it can surface
  // rejected/cancelled (which procurementBand drops). Priority sort runs within
  // every band (critical first).
  const filteredRequests = isProcurement
    ? myRequests.filter((r) =>
        matchesProcurementFilter(
          {
            status: r.status,
            eta: r.eta,
            supplier: r.supplier,
            projectId: r.project_id,
          },
          filter,
          today,
        ),
      )
    : [];
  const filterActive =
    filter.supplier !== null ||
    filter.projectId !== null ||
    filter.status !== null ||
    filter.band !== null ||
    filter.overdue;
  const procurementGroups = !isProcurement
    ? []
    : filter.status !== null
      ? filteredRequests.length > 0
        ? [
            {
              meta: {
                band: filter.status,
                label: PURCHASE_REQUEST_STATUS_LABEL[filter.status],
                hot: false,
              },
              items: sortByPriority(filteredRequests),
            },
          ]
        : []
      : groupByProcurementBand(filteredRequests).map(({ meta, items }) => ({
          meta,
          items: sortByPriority(items),
        }));

  // Spec 105: buyer's summary strip — the FULL workload (unfiltered), a stable
  // glance that doesn't jump as filters change.
  const buyerSummary = isProcurement ? procurementSummary(myRequests, today) : null;

  // Spec 138 U3: the status-chip filter — band pills (ทั้งหมด / อนุมัติแล้ว /
  // กำลังจัดส่ง / เกินกำหนด) with live counts. Counted over the rows narrowed by the
  // supplier/project axes only (so the counts track those filters) — NOT by the
  // band/overdue axes the chips themselves toggle.
  const statusChips = isProcurement
    ? buildWorklistStatusChips({
        rows: myRequests
          .filter((r) =>
            matchesProcurementFilter(
              {
                status: r.status,
                eta: r.eta,
                supplier: r.supplier,
                projectId: r.project_id,
              },
              { ...filter, band: null, overdue: false, status: null },
              today,
            ),
          )
          .map((r) => ({ status: r.status, eta: r.eta })),
        filter,
        todayIso: today,
      })
    : [];

  // Spec 106/108: amount is money → ONE admin read of all visible rows' amounts
  // (gated to procurement — back-office, it enters them; never runs for SA/PM
  // here). Feeds the ค้างจ่าย tile + the desktop grid's จำนวนเงิน column.
  const amountById = new Map<string, number | null>();
  let outstanding = 0;
  if (isProcurement && myRequests.length > 0) {
    const admin = createAdminSupabase();
    const { data: amountRows } = await admin
      .from("purchase_requests")
      .select("id, amount")
      .in(
        "id",
        myRequests.map((r) => r.id),
      );
    for (const a of amountRows ?? []) amountById.set(a.id, a.amount);
    outstanding = sumOutstanding(
      myRequests
        .filter((r) => procurementBand(r.status) === "in_transit")
        .map((r) => ({ amount: amountById.get(r.id) ?? null })),
    );
  }

  // Feedback e4c02550: once every PR reaches delivered, the four active-work tiles
  // all read 0 and the landing looked "broken". Surface the cumulative delivered
  // spend so the money stays visible (a figure, not a metric redefinition — ค้างจ่าย
  // is unchanged). Reuses the back-office amounts already read above.
  let deliveredSpend = 0;
  if (isProcurement) {
    for (const r of myRequests) {
      if (r.status === "delivered") deliveredSpend += amountById.get(r.id) ?? 0;
    }
  }

  // Spec 138 U1: the ต้องติดตามด่วน panel — the actual overdue in-transit
  // deliveries (the items behind the เกินกำหนด count), most-overdue first. Reads
  // the same unfiltered set as the KPI so the two agree; amount is the back-
  // office figure already read above.
  const attentionItems = isProcurement
    ? selectOverdueFollowUp(
        myRequests.map((r) => ({
          id: r.id,
          pr_number: r.pr_number,
          item_description: r.item_description,
          status: r.status,
          eta: r.eta,
          supplier: r.supplier,
          amount: amountById.get(r.id) ?? null,
        })),
        today,
      )
    : [];

  // Spec 134 U2: in the กำลังจัดส่ง band, bundled tickets collapse into one PO
  // card linking to the PO detail (U1). Split that band's rows into PO groups +
  // loose rows; the card's derived status + line count come from the PO's FULL
  // member set (not just the in-transit rows visible here), so it reads the same
  // roll-up the detail page shows. Desktop grid grouping is a later unit (2b).
  const inTransitGrouped = groupByPurchaseOrder(
    procurementGroups.find((g) => g.meta.band === "in_transit")?.items ?? [],
  );
  const poFactsById = new Map<
    string,
    {
      poNumber: number;
      supplier: string;
      eta: string | null;
      status: PurchaseOrderStatus;
      lineCount: number;
    }
  >();
  if (isProcurement && inTransitGrouped.poGroups.length > 0) {
    const poIds = inTransitGrouped.poGroups.map((g) => g.poId);
    const [poRes, memberRes] = await Promise.all([
      supabase.from("purchase_orders").select("id, po_number, supplier, eta").in("id", poIds),
      supabase
        .from("purchase_requests")
        .select("id, status, purchase_order_id")
        .in("purchase_order_id", poIds),
    ]);
    const memberStatusesByPo = new Map<string, PurchaseRequestStatus[]>();
    for (const m of memberRes.data ?? []) {
      if (!m.purchase_order_id) continue;
      const arr = memberStatusesByPo.get(m.purchase_order_id) ?? [];
      arr.push(m.status);
      memberStatusesByPo.set(m.purchase_order_id, arr);
    }
    for (const po of poRes.data ?? []) {
      const view = buildPoDetailView(
        (memberStatusesByPo.get(po.id) ?? []).map((status) => ({ status, amount: null })),
      );
      poFactsById.set(po.id, {
        poNumber: po.po_number,
        supplier: po.supplier,
        eta: po.eta,
        status: view.status,
        lineCount: view.activeLineCount,
      });
    }
  }

  // Spec 211 U5: PO membership must be visible in EVERY band (not just the
  // in_transit PO group header), so fetch the human PO number for every PO any
  // row belongs to and bake it onto the grid row / phone card as a PO chip.
  const poNumberById = new Map<string, number>();
  if (isProcurement) {
    const allPoIds = [
      ...new Set(
        myRequests.map((r) => r.purchase_order_id).filter((id): id is string => id != null),
      ),
    ];
    if (allPoIds.length > 0) {
      const { data: poNumRows } = await supabase
        .from("purchase_orders")
        .select("id, po_number")
        .in("id", allPoIds);
      for (const po of poNumRows ?? []) poNumberById.set(po.id, po.po_number);
    }
  }

  // Spec 114: suppliers feed the in-drawer record-purchase form; a per-request
  // attachment count feeds the drawer's document indicator. Procurement only —
  // both read under the user session (RLS admits procurement: suppliers SELECT
  // spec 33, attachments via the parent-row policy).
  let supplierRecords: SupplierOption[] = [];
  const docCountById = new Map<string, number>();
  if (isProcurement) {
    const { data: supplierRows } = await supabase
      .from("suppliers")
      .select("id, name, phone")
      .order("name", { ascending: true });
    supplierRecords = supplierRows ?? [];
    if (myRequests.length > 0) {
      const { data: attachmentRows } = await supabase
        .from("purchase_request_attachments_current")
        .select("purchase_request_id")
        .in(
          "purchase_request_id",
          myRequests.map((r) => r.id),
        );
      for (const a of attachmentRows ?? []) {
        if (a.purchase_request_id) {
          docCountById.set(
            a.purchase_request_id,
            (docCountById.get(a.purchase_request_id) ?? 0) + 1,
          );
        }
      }
    }
  }

  // Spec 109: the desktop grid + its review drawer is a client component, so the
  // page bakes wp name/code + amount into serializable records (a client boundary
  // can't take server-closure functions). Procurement-only, mirroring the bands.
  const gridGroups = procurementGroups.map(({ meta, items }) => ({
    meta,
    // Spec 134 U2b: order the in_transit band so each PO's members are contiguous
    // (PO groups first-appearance, then loose) — the grid renders a PO header
    // before each group and prev/next nav follows this visual order.
    items: (meta.band === "in_transit"
      ? (() => {
          const grouped = groupByPurchaseOrder(items);
          return [...grouped.poGroups.flatMap((g) => g.items), ...grouped.loose];
        })()
      : items
    ).map((r): ProcurementGridRecord => {
      const wp = wpFor(r.work_package_id);
      return {
        id: r.id,
        purchase_order_id: r.purchase_order_id,
        po_number: r.purchase_order_id ? (poNumberById.get(r.purchase_order_id) ?? null) : null,
        pr_number: r.pr_number,
        item_description: r.item_description,
        status: r.status,
        priority: r.priority,
        quantity: r.quantity,
        unit: r.unit,
        supplier: r.supplier,
        amount: amountById.get(r.id) ?? null,
        eta: r.eta,
        needed_by: r.needed_by,
        requested_at: r.requested_at,
        decided_at: r.decided_at,
        purchased_at: r.purchased_at,
        shipped_at: r.shipped_at,
        delivered_at: r.delivered_at,
        work_package_id: r.work_package_id,
        wp_code: wp?.code ?? null,
        wp_name: wp?.name ?? null,
        // Spec 114 drawer enrichment. Spec 195 P1: the PR's own project_id
        // (covers WP-less PRs, where there is no WP to derive it from).
        project_id: r.project_id,
        requested_by: r.requested_by,
        requester_name:
          (r.requested_by ? requesterNames.get(r.requested_by) : null) ??
          r.requested_by_email ??
          null,
        notes: r.notes,
        decision_comment: r.decision_comment,
        received_by: r.received_by,
        delivery_note: r.delivery_note,
        doc_count: docCountById.get(r.id) ?? 0,
      };
    }),
  }));

  // Spec 118: phone PO basket — the to_order band on phone becomes selectable
  // (add-to-PO) when bundling is possible (procurement + suppliers loaded). Uses
  // the same serializable grid records the desktop grid does.
  const toOrderGridItems = gridGroups.find((g) => g.meta.band === "to_order")?.items ?? [];
  const canBundlePhone = isProcurement && supplierRecords.length > 0;

  // Spec 134 U2b: serializable PO-header facts for the desktop grid (the in_transit
  // band renders a PO header row before each group). Reuses the roll-up computed for
  // the phone PO cards; eta is dropped (the header shows status + line count).
  const poFacts: Record<
    string,
    { poNumber: number; supplier: string; status: PurchaseOrderStatus; lineCount: number }
  > = {};
  for (const [poId, f] of poFactsById) {
    poFacts[poId] = {
      poNumber: f.poNumber,
      supplier: f.supplier,
      status: f.status,
      lineCount: f.lineCount,
    };
  }

  type RequestRow = (typeof myRequests)[number];
  const cardFor = (r: RequestRow) => {
    const wp = wpFor(r.work_package_id);
    // Spec 47: a slim tappable summary linking to /requests/[id].
    return (
      <li key={r.id}>
        <PurchaseRequestCard
          request={{
            id: r.id,
            pr_number: r.pr_number,
            item_description: r.item_description,
            quantity: r.quantity,
            unit: r.unit,
            status: r.status,
            priority: r.priority,
            requested_at: r.requested_at,
            needed_by: r.needed_by,
            decided_at: r.decided_at,
            purchased_at: r.purchased_at,
            shipped_at: r.shipped_at,
            delivered_at: r.delivered_at,
            eta: r.eta,
          }}
          workPackage={wp ? { code: wp.code, name: wp.name } : null}
          requesterName={
            (r.requested_by ? requesterNames.get(r.requested_by) : null) ??
            r.requested_by_email ??
            null
          }
          isMine={r.requested_by === ctx.id}
          poNumber={r.purchase_order_id ? (poNumberById.get(r.purchase_order_id) ?? null) : null}
        />
      </li>
    );
  };

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="จัดซื้อ" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />

      {/* Primary-tab nav: the desktop HubNav strip like the sibling hubs
          (/review, /projects); phones leave via the bottom tab bar.
          procurement (hubItems null) gets none — /requests is its only stop. */}
      {hubItems ? (
        <HubNav
          maxWidthClass={PAGE_MAX_W}
          items={hubItems}
          currentHref="/requests"
          role={ctx.role}
        />
      ) : null}

      <section className={`mx-auto ${PAGE_MAX_W} space-y-8 px-5 py-6`}>
        <div>
          <div className="mb-3 flex flex-col gap-2">
            <h2 className="text-ink text-base font-semibold">คำขอซื้อ</h2>
            {/* Spec 137: action-state VIEW filter (กำลังดำเนินการ default hides
                received/closed) + the spec-16 ของฉัน toggle (site staff see the whole
                site; this narrows to their own). Hidden for procurement (spec 104 — it
                has its own pipeline + filters and never owns a request). */}
            {!isProcurement ? (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {REQUEST_VIEWS.map((v) => (
                  <Link
                    key={v}
                    href={reqHref({ view: v })}
                    aria-current={requestView === v ? "true" : undefined}
                    className={worklistChipClass(requestView === v)}
                  >
                    {REQUEST_VIEW_LABEL[v]}
                  </Link>
                ))}
                <span aria-hidden className="bg-edge-strong mx-1 h-5 w-px" />
                <Link
                  href={reqHref({ mine: !mineOnly })}
                  aria-pressed={mineOnly}
                  className={worklistChipClass(mineOnly)}
                >
                  เฉพาะของฉัน
                </Link>
              </div>
            ) : null}
          </div>
          {myError ? (
            <ErrorNotice>โหลดรายการคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
          ) : isProcurement ? (
            // Spec 104/105: buyer's pipeline + summary strip (workload + overdue).
            <div className="flex flex-col gap-6">
              {/* Spec 138 U2/U4: the KPI hero row. The 2×2 tile grid sits BESIDE the
                  U1 attention panel on lg+ (1fr / 332px) and stacks (panel hidden)
                  on the phone. Tiles are built by the pure helper from the current
                  filter; the รอสั่งซื้อ / กำลังจัดส่ง tiles toggle their band (U4) and
                  the เกินกำหนด tile toggles the spec-110 chase list. */}
              {buyerSummary ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_332px] lg:items-start">
                  <div className="grid grid-cols-2 gap-3">
                    {buildWorklistKpis({
                      summary: buyerSummary,
                      outstanding: baht(outstanding),
                      deliveredSpend: baht(deliveredSpend),
                      filter,
                    }).map((tile) => (
                      <WorklistKpiTile key={tile.key} tile={tile} />
                    ))}
                  </div>
                  {/* Spec 138 U1: the overdue deliveries behind the เกินกำหนด count,
                      most-overdue first — tap a row into the request, or jump to the
                      full chase filter. Tablet/desktop only (lg+) — operator dropped
                      it from the phone view (2026-06-18); the เกินกำหนด KPI tile is
                      the phone's chase entry point. */}
                  {attentionItems.length > 0 ? (
                    <div className="hidden lg:block">
                      <OverdueFollowUpPanel
                        items={attentionItems}
                        overdueHref={buildWorklistQuery({ ...filter, overdue: true })}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {/* Spec 138 U3: the scrollable status-chip filter (band pills with
                  live counts) — replaces the status <select>. Sits between the KPI
                  hero and the supplier/project pickers. */}
              <WorklistStatusChips chips={statusChips} />
              {/* Spec 110: supplier / project filters (the status <select> moved to
                  the U3 chips above). */}
              <ProcurementFilters
                filter={filter}
                suppliers={supplierOptions}
                projects={projectOptions}
              />
              {procurementGroups.length === 0 ? (
                <EmptyNotice>
                  {filterActive ? "ไม่พบคำขอซื้อตามตัวกรอง" : "ยังไม่มีคำขอซื้อ"}
                </EmptyNotice>
              ) : (
                <>
                  {/* Spec 104: card pipeline on phone. */}
                  <div className="flex flex-col gap-6 lg:hidden">
                    {procurementGroups.map(({ meta, items }) => (
                      <section key={meta.band} className="flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                          <h3
                            className={`text-section font-extrabold ${
                              meta.hot ? "text-attn-ink" : "text-ink"
                            }`}
                          >
                            {meta.label}
                          </h3>
                          <span
                            className={`text-meta inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold ${
                              meta.hot ? "bg-attn text-on-attn" : "bg-sunk text-ink-secondary"
                            }`}
                          >
                            {items.length}
                          </span>
                        </div>
                        {meta.band === "to_order" && canBundlePhone ? (
                          <PhonePoBasket records={toOrderGridItems} suppliers={supplierRecords} />
                        ) : meta.band === "in_transit" && inTransitGrouped.poGroups.length > 0 ? (
                          /* Spec 134 U2: bundled tickets → one PO card, loose
                             tickets keep their own card. */
                          <ul className="flex flex-col gap-2">
                            {inTransitGrouped.poGroups.map((g) => {
                              const facts = poFactsById.get(g.poId);
                              return facts ? (
                                <li key={g.poId}>
                                  <PoGroupCard
                                    poId={g.poId}
                                    poNumber={facts.poNumber}
                                    supplier={facts.supplier}
                                    status={facts.status}
                                    lineCount={facts.lineCount}
                                    eta={facts.eta}
                                  />
                                </li>
                              ) : null;
                            })}
                            {inTransitGrouped.loose.map(cardFor)}
                          </ul>
                        ) : (
                          <ul className="flex flex-col gap-2">{items.map(cardFor)}</ul>
                        )}
                      </section>
                    ))}
                  </div>
                  {/* Spec 108: dense grid worklist on tablet/desktop. Spec 109:
                      a row opens the record-review drawer (prev/next). */}
                  <div className="hidden lg:block">
                    <ProcurementGrid
                      groups={gridGroups}
                      today={today}
                      suppliers={supplierRecords}
                      userId={ctx.id}
                      poFacts={poFacts}
                    />
                  </div>
                </>
              )}
            </div>
          ) : myRequests.length === 0 ? (
            <EmptyNotice>{mineOnly ? "คุณยังไม่เคยสร้างคำขอซื้อ" : "ยังไม่มีคำขอซื้อ"}</EmptyNotice>
          ) : requestBands.length === 0 ? (
            <EmptyNotice>ไม่มีคำขอซื้อในมุมมองนี้</EmptyNotice>
          ) : (
            // Spec 137: action-state bands — most-actionable first. Styled like the
            // procurement pipeline (hot band amber); the hot band here is กำลังจัดส่ง
            // (incoming → what site receives). Overdue arrivals get a เลยกำหนด flag.
            <div className="flex flex-col gap-6">
              {requestBands.map((group) => (
                <section key={group.band} className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <h3
                      className={`text-section font-extrabold ${
                        group.hot ? "text-attn-ink" : "text-ink"
                      }`}
                    >
                      {group.label}
                    </h3>
                    <span
                      className={`text-meta inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold ${
                        group.hot ? "bg-attn text-on-attn" : "bg-sunk text-ink-secondary"
                      }`}
                    >
                      {group.items.length}
                    </span>
                    {group.overdue > 0 ? (
                      <span className="bg-danger text-on-fill text-meta inline-flex h-5 items-center rounded-full px-2 font-bold">
                        เลยกำหนด {group.overdue}
                      </span>
                    ) : null}
                  </div>
                  <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3">
                    {group.items.map(cardFor)}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {myRequests && myRequests.length > 0 ? (
            <p className="text-ink-secondary mt-3 text-xs">
              กดที่คำขอเพื่อดูรายละเอียดและดำเนินการ — เมื่อผู้จัดการโครงการอนุมัติคำขอแล้ว
              ฝ่ายจัดซื้อบันทึกการสั่งซื้อและการจัดส่งได้ในหน้ารายละเอียดคำขอและในระบบหลังบ้าน —
              สถานะ &ldquo;สั่งซื้อแล้ว&rdquo; และ &ldquo;กำลังจัดส่ง&rdquo;
              จะอัปเดตอัตโนมัติจากบันทึก เมื่อของถึงหน้างาน ถ่ายรูปยืนยันการรับของได้ทันทีที่สถานะ
              &ldquo;กำลังจัดส่ง&rdquo; — ระบบจะบันทึกเป็น &ldquo;ได้รับของแล้ว&rdquo; ให้อัตโนมัติ
            </p>
          ) : null}
        </div>
      </section>
    </PageShell>
  );
}

// Spec 137: the site worklist filter chip — pressed (fill) vs idle (outline).
function worklistChipClass(active: boolean): string {
  return `focus-visible:ring-action inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
    active
      ? "border-fill bg-fill text-on-fill font-semibold"
      : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
  }`;
}
