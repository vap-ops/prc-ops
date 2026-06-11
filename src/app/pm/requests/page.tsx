import Link from "next/link";
import { AppHeader } from "@/components/features/app-header";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { PurchaseRequestDecision } from "@/components/features/purchase-request-decision";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { formatThaiDateTime } from "@/lib/i18n/labels";

// /pm/requests — PM (and super_admin) review queue for purchase requests.
// site_admin lands on /requests for their own queue but cannot reach this
// page (requireRole redirects via roleHome → /sa).
//
// Queue is ordered oldest-first by requested_at (the index in the
// migration is purpose-built for this: (status, requested_at desc)
// scans in reverse for the asc form). status filter is the one this
// table cares about — 'requested' rows only.
//
// Requester names are resolved via the admin client because the users
// RLS doesn't admit PM cross-user reads (ADR 0011 / fix-recursion) —
// the shared fetchDisplayNames helper (src/lib/users/display-names.ts),
// same as the PM WP review page. Failure to resolve is non-fatal — the
// row falls back to the email (AppSheet path, P2) or em-dash.

export const metadata = { title: "คำขอซื้อ" };

export default async function PmRequestsPage() {
  const ctx = await requireRole(["project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: requests, error } = await supabase
    .from("purchase_requests")
    .select(
      "id, work_package_id, item_description, quantity, unit, requested_at, requested_by, requested_by_email",
    )
    .eq("status", "requested")
    .order("requested_at", { ascending: true });

  const wpIds = Array.from(new Set((requests ?? []).map((r) => r.work_package_id)));
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("id, code, name")
    .in("id", wpIds);
  const wpById = new Map((wpRows ?? []).map((wp) => [wp.id, wp]));

  const requesterIds = Array.from(
    new Set(
      (requests ?? [])
        .map((r) => r.requested_by)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  const requesterNames = await fetchDisplayNames(requesterIds, "[pm/requests]");

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <AppHeader kicker="คำขอซื้อ" fullName={ctx.fullName} maxWidthClass="max-w-3xl" />

      <nav className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-4 text-xs">
          <Link
            href="/pm"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            ← รายการรอตรวจ
          </Link>
          <span className="text-zinc-100">คำขอซื้อ</span>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-5 py-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">รออนุมัติ</h2>

        {error ? (
          <ErrorNotice>โหลดรายการคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
        ) : !requests || requests.length === 0 ? (
          <EmptyNotice>ไม่มีคำขอซื้อรออนุมัติ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((r) => {
              const wp = wpById.get(r.work_package_id);
              const requesterName =
                (r.requested_by ? requesterNames.get(r.requested_by) : null) ??
                r.requested_by_email ??
                "—";
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
                >
                  <div className="space-y-0.5">
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
                      ขอซื้อโดย {requesterName}
                      <span className="mx-1 text-zinc-700">·</span>
                      ขอเมื่อ {formatThaiDateTime(r.requested_at)}
                    </p>
                  </div>
                  <PurchaseRequestDecision requestId={r.id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
