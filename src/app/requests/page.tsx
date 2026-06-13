import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/features/app-header";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { PURCHASING_ROLES, roleHome } from "@/lib/auth/role-home";
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
import { PurchaseRequestCard } from "@/components/features/purchase-request-card";
import { fetchDisplayNames } from "@/lib/users/display-names";

// Spec 19 §4: the single purchasing surface for every role. The list is
// pending-first (priority band then requested asc — spec-16 A2), decided
// rows below newest-first; site-wide for every role since spec-16
// addendum A1 / ADR 0026. Spec 47: each row is a slim card linking to
// /requests/[id] — facts and every action zone (decision, recording,
// shipping, cancel, attachments) render on the detail screen.
export const metadata = { title: "คำขอซื้อ" };

interface RequestsPageProps {
  searchParams: Promise<{ wp?: string | string[]; mine?: string | string[] }>;
}

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const supabase = await createClient();

  // Spec 70: procurement is a back-office processor, not a requester — it is
  // not in the purchase_requests INSERT policy and has no WP link to arrive
  // ?wp=-pinned, so the create-request section is inert for it. Hide it.
  const canCreateRequests = ctx.role !== "procurement";

  const { wp: wpParam, mine: mineParam } = await searchParams;
  const wpRequested = wpParam !== undefined;

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

  // Back affordance (spec 12): pinned → the WP screen the user came from
  // (the SA WP route admits sa/pm/super, so it is valid for every role
  // that can reach this form); bare → the caller's role home.
  const backHref =
    pinnedWp && pinnedProjectId
      ? `/sa/projects/${pinnedProjectId}/work-packages/${pinnedWp.id}`
      : roleHome(ctx.role);
  const backLabel = pinnedWp && pinnedProjectId ? "กลับไปหน้ารายการงาน" : "กลับ";

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
  const { data: visibleRequests, error: myError } = await supabase
    .from("purchase_requests")
    .select(PR_LIST_COLUMNS)
    .order("requested_at", { ascending: false });

  // ของฉัน filter chip (spec 16 A1): ?mine=1 narrows to the caller's own
  // rows. Server-side via searchParams — same zero-client-JS pattern as
  // the rest of the page (deviation from A1's "client-side" wording,
  // recorded in the tracker).
  const mineOnly = mineParam === "1";
  const allVisible = (visibleRequests ?? []).filter((r) => !mineOnly || r.requested_by === ctx.id);

  // Pending-first (spec 19 §4 + addendum A2): requested rows by priority
  // band (critical → urgent → normal) then oldest-first; decided rows
  // below newest-first (the history). In-process sort, not SQL ORDER BY:
  // one fetch serves both bands' opposite date orders (deviation from
  // A2's "order by" wording, recorded in the tracker). Comparator
  // extracted + pinned by unit test (spec 36).
  const pendingRows = allVisible
    .filter((r) => r.status === "requested")
    .sort(comparePendingRequests);
  const decidedRows = allVisible.filter((r) => r.status !== "requested");
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

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="คำขอซื้อ" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />

      {/* Pinned mode keeps the contextual spec-12 back-bar everywhere; in
          bare mode /requests is a TAB ROOT — on phones the bottom tabs
          are the way out and a bare กลับ reads as broken UX (operator
          report 2026-06-11), so the strip is desktop-only there. */}
      <nav
        className={`border-b border-zinc-200 bg-zinc-100 px-5 py-1 ${
          pinnedWp && pinnedProjectId ? "" : "hidden sm:block"
        }`}
      >
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center`}>
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-blue-700 transition-colors hover:underline focus:outline-none focus-visible:underline"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {backLabel}
          </Link>
        </div>
      </nav>

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
                <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-600">
                  คำขอซื้อเริ่มจากหน้ารายการงาน — เปิดรายการงานที่ต้องการ แล้วกด{" "}
                  <span className="font-medium text-zinc-900">สร้างคำขอซื้อ</span>{" "}
                  จากนั้นผู้จัดการโครงการจะเป็นผู้พิจารณาอนุมัติ —
                  หากไม่อนุมัติจะมีความเห็นแจ้งเหตุผลเสมอ
                </p>
              </div>
            )}
          </div>
        ) : null}

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900">คำขอซื้อ</h2>
            {/* ของฉัน filter chip (spec 16 A1) — site staff see the whole
                site's requests; the chip narrows back to their own. A live
                pinned WP survives the toggle (chips are a filter, not
                navigation — the form and spec-12 back-bar stay mounted). */}
            <div className="flex gap-1 text-xs">
              <Link
                href={pinnedWp ? `/requests?wp=${pinnedWp.id}` : "/requests"}
                aria-current={!mineOnly ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px ${
                  !mineOnly
                    ? "border-slate-900 bg-slate-900 font-semibold text-white"
                    : "border-zinc-400 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                ทั้งหมด
              </Link>
              <Link
                href={pinnedWp ? `/requests?wp=${pinnedWp.id}&mine=1` : "/requests?mine=1"}
                aria-current={mineOnly ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px ${
                  mineOnly
                    ? "border-slate-900 bg-slate-900 font-semibold text-white"
                    : "border-zinc-400 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                ของฉัน
              </Link>
            </div>
          </div>
          {myError ? (
            <ErrorNotice>โหลดรายการคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
          ) : myRequests.length === 0 ? (
            <EmptyNotice>{mineOnly ? "คุณยังไม่เคยสร้างคำขอซื้อ" : "ยังไม่มีคำขอซื้อ"}</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3">
              {myRequests.map((r) => {
                const wp = wpById.get(r.work_package_id);
                // Spec 47: the card is a slim tappable summary linking to
                // /requests/[id] — facts and actions live on the detail
                // screen now.
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
              })}
            </ul>
          )}
          {myRequests && myRequests.length > 0 ? (
            <p className="mt-3 text-xs text-zinc-600">
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
