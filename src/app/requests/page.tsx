import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/features/app-header";
import { HubNav, PM_HUB_NAV, SA_HUB_NAV, PROCUREMENT_HUB_NAV } from "@/components/features/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { PURCHASING_ROLES } from "@/lib/auth/role-home";
import { workPackageHref } from "@/lib/nav/project-paths";
import {
  PurchaseRequestForm,
  type PurchaseRequestFormWorkPackage,
} from "@/components/features/purchase-request-form";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { isValidUuid } from "@/lib/photos/path";
import { PR_LIST_COLUMNS } from "@/lib/purchasing/columns";
import { SECTION_HEADING } from "@/lib/ui/classes";

// /requests — THE purchasing surface for every role (spec 19 §4 merged
// the PM decision queue here; spec 16 A1 / ADR 0026 made the list
// site-wide). The request form appears when arriving FROM a work package
// (spec 10: ?wp=<id> pins the WP; there is no picker — WP screens carry
// the "Raise purchase request" link). Authorized: site_admin,
// project_manager, super_admin — the v1 requester base (ADR 0022).
//
// Server-side fetches:
//   1. the ?wp= work package (only when the param has UUID shape) — RLS on
//      work_packages already gates readability to wp-readers; an
//      unreadable or unknown id resolves to null and the form is withheld.
//   2. ALL visible purchase_requests — RLS decides (site_admin/PM/
//      procurement/super see every row since ADR 0026; the own-row
//      branch remains for future narrower roles). The ?mine=1 chip
//      narrows back to the caller's own rows.

import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { comparePendingRequests } from "@/lib/purchasing/pending-order";
import {
  groupByProcurementBand,
  procurementSummary,
  procurementBand,
  sumOutstanding,
} from "@/lib/purchasing/procurement-pipeline";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { PurchaseRequestCard } from "@/components/features/purchase-request-card";
import {
  ProcurementGrid,
  type ProcurementGridRecord,
} from "@/components/features/procurement-grid";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { ProcurementFilters } from "@/components/features/procurement-filters";
import {
  matchesProcurementFilter,
  sortByPriority,
  distinctSuppliers,
  distinctProjects,
  buildWorklistQuery,
  type ProcurementFilter,
} from "@/lib/purchasing/worklist-filter";
import { PURCHASE_REQUEST_STATUS_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";

// Spec 19 §4: the single purchasing surface for every role. The list is
// pending-first (priority band then requested asc — spec-16 A2), decided
// rows below newest-first; site-wide for every role since spec-16
// addendum A1 / ADR 0026. Spec 47: each row is a slim card linking to
// /requests/[id] — facts and every action zone (decision, recording,
// shipping, cancel, attachments) render on the detail screen.
export const metadata = { title: "คำขอซื้อ" };

interface RequestsPageProps {
  searchParams: Promise<{
    wp?: string | string[];
    mine?: string | string[];
    // Spec 110: procurement worklist filters.
    supplier?: string | string[];
    project?: string | string[];
    status?: string | string[];
    overdue?: string | string[];
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

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const supabase = await createClient();

  // Spec 70: procurement is a back-office processor, not a requester — it is
  // not in the purchase_requests INSERT policy and has no WP link to arrive
  // ?wp=-pinned, so the create-request section is inert for it. Hide it.
  const canCreateRequests = ctx.role !== "procurement";

  const {
    wp: wpParam,
    mine: mineParam,
    supplier: supplierParam,
    project: projectParam,
    status: statusParam,
    overdue: overdueParam,
  } = await searchParams;
  const wpRequested = wpParam !== undefined;

  // Spec 110: parse the worklist filter (procurement only — SA/PM ignore it).
  // An unknown status value is dropped (treated as "all") so a hand-edited URL
  // can't pass garbage to the filter.
  const statusParamValue = singleParam(statusParam);
  const filter: ProcurementFilter = {
    supplier: singleParam(supplierParam),
    projectId: singleParam(projectParam),
    overdue: singleParam(overdueParam) === "1",
    status:
      statusParamValue !== null && PR_STATUSES.has(statusParamValue)
        ? (statusParamValue as PurchaseRequestStatus)
        : null,
  };

  // Resolve the pinned WP only for a well-formed single UUID; anything
  // else (missing, repeated, garbage, or unreadable under RLS) leaves the
  // form withheld. maybeSingle() returns null rather than erroring when
  // RLS filters the row out, so "not found" and "not allowed" look the
  // same here — intentionally.
  let pinnedWp: PurchaseRequestFormWorkPackage | null = null;
  let pinnedProjectId: string | null = null;
  if (typeof wpParam === "string" && isValidUuid(wpParam)) {
    const { data } = await supabase
      .from("work_packages")
      .select("id, code, name, project_id")
      .eq("id", wpParam)
      .maybeSingle();
    if (data) {
      pinnedWp = { id: data.id, code: data.code, name: data.name };
      pinnedProjectId = data.project_id;
    }
  }

  // Bare /requests is a PRIMARY TAB: like /review and /projects it carries the
  // desktop HubNav strip (the role's tab set) — NOT a back-bar. Spec 101 gives
  // procurement its own strip (worklist + suppliers + settings). The contextual
  // spec-12 back-bar (below) only renders when pinned — arriving from a WP to
  // raise a request is a drill-down, so it returns to that WP.
  const hubItems =
    ctx.role === "project_manager" || ctx.role === "super_admin"
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
    .select(PR_LIST_COLUMNS)
    .eq("status", "requested");
  if (mineOnly) pendingQuery = pendingQuery.eq("requested_by", ctx.id);

  let decidedFilter = supabase
    .from("purchase_requests")
    .select(PR_LIST_COLUMNS)
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
  const wpIdsInRequests = Array.from(new Set(myRequests.map((r) => r.work_package_id)));
  const { data: wpForRequests } = await supabase
    .from("work_packages")
    .select("id, code, name, project_id")
    .in("id", wpIdsInRequests);
  const wpById = new Map((wpForRequests ?? []).map((wp) => [wp.id, wp]));

  const isProcurement = ctx.role === "procurement";
  const today = bangkokTodayISO();

  // Spec 110: project names for the project filter (procurement reads projects
  // read-only since spec 102 — RLS admits it, no migration). Procurement-only.
  const projectNameById = new Map<string, string>();
  if (isProcurement) {
    const projectIds = Array.from(new Set((wpForRequests ?? []).map((wp) => wp.project_id)));
    if (projectIds.length > 0) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", projectIds);
      for (const p of projectRows ?? []) projectNameById.set(p.id, p.name);
    }
  }
  const projectIdOf = (wpId: string) => wpById.get(wpId)?.project_id ?? null;

  // Spec 110: filter picker options come from the UNFILTERED set so the filter
  // can always be changed.
  const supplierOptions = isProcurement ? distinctSuppliers(myRequests) : [];
  const projectOptions = isProcurement
    ? distinctProjects(
        myRequests.map((r) => {
          const pid = projectIdOf(r.work_package_id);
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
            projectId: projectIdOf(r.work_package_id),
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

  // Spec 109: the desktop grid + its review drawer is a client component, so the
  // page bakes wp name/code + amount into serializable records (a client boundary
  // can't take server-closure functions). Procurement-only, mirroring the bands.
  const gridGroups = procurementGroups.map(({ meta, items }) => ({
    meta,
    items: items.map((r): ProcurementGridRecord => {
      const wp = wpById.get(r.work_package_id);
      return {
        id: r.id,
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
      };
    }),
  }));

  type RequestRow = (typeof myRequests)[number];
  const cardFor = (r: RequestRow) => {
    const wp = wpById.get(r.work_package_id);
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
        />
      </li>
    );
  };

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="คำขอซื้อ" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />

      {/* Spec 12 contextual back vs. primary-tab nav. Pinned (?wp= from a WP)
          is a drill-down — show the contextual back to that WP. Bare is the
          tab root — show the desktop HubNav strip like the sibling hubs
          (/review, /projects); phones leave via the bottom tab bar. procurement
          (hubItems null) gets neither: /requests is its only destination. */}
      {pinnedWp && pinnedProjectId ? (
        <nav className="border-edge bg-sunk border-b px-5 py-1">
          <div className={`mx-auto flex ${PAGE_MAX_W} items-center`}>
            <Link
              href={workPackageHref(pinnedProjectId, pinnedWp.id)}
              className="text-action inline-flex min-h-11 items-center gap-1.5 text-xs font-medium transition-colors hover:underline focus:outline-none focus-visible:underline"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              กลับไปหน้ารายการงาน
            </Link>
          </div>
        </nav>
      ) : hubItems ? (
        <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/requests" />
      ) : null}

      <section className={`mx-auto ${PAGE_MAX_W} space-y-8 px-5 py-6`}>
        {/* Spec 70: hidden for procurement (a processor, not a requester). */}
        {canCreateRequests ? (
          <div>
            <h2 className={SECTION_HEADING}>สร้างคำขอซื้อ</h2>
            {pinnedWp && pinnedProjectId ? (
              <PurchaseRequestForm
                workPackage={pinnedWp}
                projectId={pinnedProjectId}
                userId={ctx.id}
              />
            ) : (
              <div className="space-y-2">
                {wpRequested ? <ErrorNotice>ไม่พบรายการงาน</ErrorNotice> : null}
                <p className="border-edge bg-page text-ink-secondary rounded-lg border px-4 py-4 text-sm">
                  คำขอซื้อเริ่มจากหน้ารายการงาน — เปิดรายการงานที่ต้องการ แล้วกด{" "}
                  <span className="text-ink font-medium">สร้างคำขอซื้อ</span>{" "}
                  จากนั้นผู้จัดการโครงการจะเป็นผู้พิจารณาอนุมัติ —
                  หากไม่อนุมัติจะมีความเห็นแจ้งเหตุผลเสมอ
                </p>
              </div>
            )}
          </div>
        ) : null}

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-ink text-base font-semibold">คำขอซื้อ</h2>
            {/* ของฉัน filter chip (spec 16 A1) — site staff see the whole
                site's requests; the chip narrows back to their own. A live
                pinned WP survives the toggle (chips are a filter, not
                navigation — the form and spec-12 back-bar stay mounted). */}
            {/* Spec 104: the ของฉัน filter is meaningless for procurement
                (it never owns a request) — hidden. */}
            {!isProcurement ? (
              <div className="flex gap-1 text-xs">
                <Link
                  href={pinnedWp ? `/requests?wp=${pinnedWp.id}` : "/requests"}
                  aria-current={!mineOnly ? "true" : undefined}
                  className={`focus-visible:ring-action inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
                    !mineOnly
                      ? "border-fill bg-fill text-on-fill font-semibold"
                      : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
                  }`}
                >
                  ทั้งหมด
                </Link>
                <Link
                  href={pinnedWp ? `/requests?wp=${pinnedWp.id}&mine=1` : "/requests?mine=1"}
                  aria-current={mineOnly ? "true" : undefined}
                  className={`focus-visible:ring-action inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
                    mineOnly
                      ? "border-fill bg-fill text-on-fill font-semibold"
                      : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
                  }`}
                >
                  ของฉัน
                </Link>
              </div>
            ) : null}
          </div>
          {myError ? (
            <ErrorNotice>โหลดรายการคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
          ) : isProcurement ? (
            // Spec 104/105: buyer's pipeline + summary strip (workload + overdue).
            <div className="flex flex-col gap-6">
              {buyerSummary ? (
                <div className="grid grid-cols-2 gap-2">
                  <BuyerStat label="รอสั่งซื้อ" value={String(buyerSummary.toOrder)} tone="hot" />
                  <BuyerStat
                    label="กำลังจัดส่ง"
                    value={String(buyerSummary.inTransit)}
                    tone="neutral"
                  />
                  {/* Spec 110: the เกินกำหนด tile is also the overdue filter
                      toggle (the chase list). */}
                  <BuyerStat
                    label="เกินกำหนด"
                    value={String(buyerSummary.overdue)}
                    tone={buyerSummary.overdue > 0 || filter.overdue ? "danger" : "neutral"}
                    href={buildWorklistQuery({ ...filter, overdue: !filter.overdue })}
                    active={filter.overdue}
                  />
                  {/* Spec 106: ฿ committed on in-transit POs (back-office money). */}
                  <BuyerStat label="ค้างจ่าย" value={baht(outstanding)} tone="neutral" />
                </div>
              ) : null}
              {/* Spec 110: supplier / project / status filters. */}
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
                        <ul className="flex flex-col gap-2">{items.map(cardFor)}</ul>
                      </section>
                    ))}
                  </div>
                  {/* Spec 108: dense grid worklist on tablet/desktop. Spec 109:
                      a row opens the record-review drawer (prev/next). */}
                  <div className="hidden lg:block">
                    <ProcurementGrid groups={gridGroups} today={today} />
                  </div>
                </>
              )}
            </div>
          ) : myRequests.length === 0 ? (
            <EmptyNotice>{mineOnly ? "คุณยังไม่เคยสร้างคำขอซื้อ" : "ยังไม่มีคำขอซื้อ"}</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3">
              {myRequests.map(cardFor)}
            </ul>
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

// Spec 106: compact THB formatter for the outstanding tile.
const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;

// Spec 105: a buyer-summary stat tile. hot = the actionable รอสั่งซื้อ band;
// danger = overdue ETAs need chasing; neutral otherwise. Spec 110: a tile with
// an href is a filter toggle (the เกินกำหนด chase list) — renders as a Link with
// a pressed ring when active.
function BuyerStat({
  label,
  value,
  tone,
  href,
  active,
}: {
  label: string;
  value: string;
  tone: "hot" | "danger" | "neutral";
  href?: string;
  active?: boolean;
}) {
  const toneClass =
    tone === "hot"
      ? "border-attn-press bg-attn text-on-attn"
      : tone === "danger"
        ? "border-danger-edge bg-danger-soft text-danger-ink"
        : "border-edge bg-card text-ink";
  const base = `rounded-card flex min-h-[68px] flex-col items-start justify-center border-[1.5px] px-3 py-2 ${toneClass}`;
  const content = (
    <>
      <span className="text-2xl leading-none font-extrabold">{value}</span>
      <span className="text-meta mt-1 font-bold">{label}</span>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        aria-pressed={active ? "true" : "false"}
        className={`${base} focus-visible:ring-action transition-shadow focus:outline-none focus-visible:ring-2 ${
          active ? "ring-action ring-2 ring-offset-1" : "hover:shadow-card"
        }`}
      >
        {content}
      </Link>
    );
  }
  return <div className={base}>{content}</div>;
}
