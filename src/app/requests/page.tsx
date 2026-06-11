import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/features/app-header";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { roleHome } from "@/lib/auth/role-home";
import {
  PurchaseRequestForm,
  type PurchaseRequestFormWorkPackage,
} from "@/components/features/purchase-request-form";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { isValidUuid } from "@/lib/photos/path";
import type { Database } from "@/lib/db/database.types";

// /requests — purchase requests: the caller's own list, plus the request
// form when arriving FROM a work package (spec 10: ?wp=<id> pins the WP;
// there is no picker — WP screens carry the "Raise purchase request" link).
// Authorized: site_admin, project_manager, super_admin — the v1 requester
// base (ADR 0022). Other roles are bounced via requireRole's roleHome().
//
// Server-side fetches:
//   1. the ?wp= work package (only when the param has UUID shape) — RLS on
//      work_packages already gates readability to wp-readers; an
//      unreadable or unknown id resolves to null and the form is withheld.
//   2. the caller's OWN purchase_requests — the "My requests" list.
//      RLS on purchase_requests admits requested_by = auth.uid() for any
//      role, so this works for SA's own rows too (SAs can't see other
//      SAs' rows, per the cross-user isolation pinned in ADR 0022).

import { PURCHASE_REQUEST_STATUS_LABEL, formatThaiDateTime } from "@/lib/i18n/labels";
import { purchaseRequestStatusPillClasses } from "@/lib/status-colors";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export const metadata = { title: "คำขอซื้อของฉัน" };

interface RequestsPageProps {
  searchParams: Promise<{ wp?: string | string[] }>;
}

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { wp: wpParam } = await searchParams;
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

  // The own-row SELECT policy (ADR 0022) admits the whole row, so the
  // decision + back-office fact columns are readable here. The PM's
  // rejection comment is mandatory at the DB layer
  // (pr_reject_has_comment); purchased_at / supplier / delivered_at /
  // received_by / delivery_note are written by procurement in AppSheet
  // (ADR 0025) and are null until that stage.
  const { data: myRequests, error: myError } = await supabase
    .from("purchase_requests")
    .select(
      "id, work_package_id, item_description, quantity, unit, status, requested_at, decision_comment, decided_at, purchased_at, supplier, delivered_at, received_by, delivery_note",
    )
    .eq("requested_by", ctx.id)
    .order("requested_at", { ascending: false });

  // Resolve WP code/name for the "My requests" list. PostgREST's foreign-
  // table inflection would also work, but a separate query mirrors the
  // pm/page.tsx + current-photos.ts convention and keeps the typed shape
  // legible to readers.
  const wpIdsInRequests = Array.from(new Set((myRequests ?? []).map((r) => r.work_package_id)));
  const { data: wpForRequests } = await supabase
    .from("work_packages")
    .select("id, code, name")
    .in("id", wpIdsInRequests);
  const wpById = new Map((wpForRequests ?? []).map((wp) => [wp.id, wp]));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <AppHeader kicker="คำขอซื้อ" fullName={ctx.fullName} maxWidthClass="max-w-3xl" />

      <nav className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-1">
        <div className="mx-auto flex max-w-3xl items-center">
          <Link
            href={backHref}
            className="inline-flex min-h-10 items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {backLabel}
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl space-y-8 px-5 py-6">
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">สร้างคำขอซื้อ</h2>
          {pinnedWp ? (
            <PurchaseRequestForm workPackage={pinnedWp} />
          ) : (
            <div className="space-y-2">
              {wpRequested ? <ErrorNotice>ไม่พบรายการงาน</ErrorNotice> : null}
              <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-4 text-sm text-zinc-400">
                คำขอซื้อเริ่มจากหน้ารายการงาน — เปิดรายการงานที่ต้องการ แล้วกด{" "}
                <span className="text-zinc-200">สร้างคำขอซื้อ</span>{" "}
                จากนั้นผู้จัดการโครงการจะเป็นผู้พิจารณาอนุมัติ —
                หากไม่อนุมัติจะมีความเห็นแจ้งเหตุผลเสมอ
              </p>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">คำขอซื้อของฉัน</h2>
          {myError ? (
            <ErrorNotice>โหลดรายการคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
          ) : !myRequests || myRequests.length === 0 ? (
            <EmptyNotice>คุณยังไม่เคยสร้างคำขอซื้อ</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2">
              {myRequests.map((r) => {
                const wp = wpById.get(r.work_package_id);
                const status = r.status as PurchaseRequestStatus;
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        {wp ? (
                          <p className="truncate text-xs text-zinc-500">
                            <span className="font-mono">{wp.code}</span>
                            <span className="mx-1">·</span>
                            {wp.name}
                          </p>
                        ) : null}
                        <p className="truncate text-base text-zinc-100">
                          {r.item_description}
                          <span className="mx-2 text-zinc-700">·</span>
                          <span className="text-zinc-300">
                            {r.quantity} {r.unit}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500">
                          ขอเมื่อ {formatThaiDateTime(r.requested_at)}
                        </p>
                      </div>
                      <StatusPill pillClasses={purchaseRequestStatusPillClasses(status)}>
                        {PURCHASE_REQUEST_STATUS_LABEL[status]}
                      </StatusPill>
                    </div>
                    {status === "approved" && r.decided_at ? (
                      <p className="mt-2 text-xs text-zinc-400">
                        อนุมัติเมื่อ {formatThaiDateTime(r.decided_at)}
                      </p>
                    ) : null}
                    {status === "rejected" && r.decision_comment ? (
                      <div className="mt-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2">
                        <p className="text-xs font-medium text-red-200">เหตุผลที่ไม่อนุมัติ</p>
                        <p className="mt-0.5 text-sm whitespace-pre-wrap text-red-100">
                          {r.decision_comment}
                        </p>
                        {r.decided_at ? (
                          <p className="mt-1 text-xs text-red-200/70">
                            พิจารณาเมื่อ {formatThaiDateTime(r.decided_at)}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {(status === "purchased" || status === "delivered") && r.purchased_at ? (
                      <p className="mt-2 text-xs text-zinc-400">
                        สั่งซื้อเมื่อ {formatThaiDateTime(r.purchased_at)}
                        {r.supplier ? ` · ผู้ขาย ${r.supplier}` : ""}
                      </p>
                    ) : null}
                    {status === "delivered" && r.delivered_at ? (
                      <p className="mt-1 text-xs text-emerald-200/80">
                        ได้รับของเมื่อ {formatThaiDateTime(r.delivered_at)}
                        {r.received_by ? ` · ผู้รับของ ${r.received_by}` : ""}
                      </p>
                    ) : null}
                    {status === "delivered" && r.delivery_note ? (
                      <p className="mt-1 text-xs whitespace-pre-wrap text-zinc-400">
                        {r.delivery_note}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {myRequests && myRequests.length > 0 ? (
            <p className="mt-3 text-xs text-zinc-500">
              เมื่อผู้จัดการโครงการอนุมัติคำขอแล้ว ฝ่ายจัดซื้อจะดำเนินการต่อในระบบหลังบ้าน — สถานะ
              &ldquo;สั่งซื้อแล้ว&rdquo; และ &ldquo;ได้รับของแล้ว&rdquo;
              จะอัปเดตอัตโนมัติจากบันทึกของฝ่ายจัดซื้อ ไม่สามารถแก้ไขในแอปนี้ได้
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
