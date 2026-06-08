import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import {
  PurchaseRequestForm,
  type PurchaseRequestFormWorkPackage,
} from "@/components/features/purchase-request-form";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import type { Database } from "@/lib/db/database.types";

// /requests — native UI for raising purchase requests against work packages.
// Authorized: site_admin, project_manager, super_admin — the v1 requester
// base (ADR 0022). Other roles are bounced via requireRole's roleHome().
//
// Two server-side fetches feed the page:
//   1. work_packages the caller can SELECT — drives the form's picker.
//      RLS on work_packages already gates this to wp-readers.
//   2. the caller's OWN purchase_requests — the "My requests" list.
//      RLS on purchase_requests admits requested_by = auth.uid() for any
//      role, so this works for SA's own rows too (SAs can't see other
//      SAs' rows, per the cross-user isolation pinned in ADR 0022).

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  purchased: "Purchased",
  delivered: "Delivered",
};

// Pill palette — zinc / amber / emerald / red, mirroring the SA-side
// pills and the inline pm/page.tsx decisionPillClasses. Inline because
// purchase_request_status only appears on this page in v1 (the
// /pm/requests queue is filtered to status='requested' and doesn't need
// a per-row pill).
function statusPillClasses(status: PurchaseRequestStatus): string {
  switch (status) {
    case "requested":
      return "border-zinc-700 bg-zinc-800 text-zinc-300";
    case "approved":
      return "border-emerald-900/60 bg-emerald-950/40 text-emerald-200";
    case "rejected":
      return "border-red-900/60 bg-red-950/40 text-red-200";
    case "purchased":
      return "border-amber-900/60 bg-amber-950/40 text-amber-200";
    case "delivered":
      return "border-emerald-900/60 bg-emerald-950/40 text-emerald-200";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "border-zinc-700 bg-zinc-800 text-zinc-300";
    }
  }
}

export default async function RequestsPage() {
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: wpRows, error: wpError } = await supabase
    .from("work_packages")
    .select("id, code, name")
    .order("code", { ascending: true });

  const workPackages: ReadonlyArray<PurchaseRequestFormWorkPackage> = (wpRows ?? []).map((wp) => ({
    id: wp.id,
    code: wp.code,
    name: wp.name,
  }));

  const { data: myRequests, error: myError } = await supabase
    .from("purchase_requests")
    .select("id, work_package_id, item_description, quantity, unit, status, requested_at")
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
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-wider text-zinc-500 uppercase">Purchase requests</p>
            <h1 className="text-lg font-semibold tracking-tight">Hi, {ctx.fullName ?? "there"}.</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/profile"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:underline"
            >
              Profile
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-3xl space-y-8 px-5 py-6">
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Raise a request</h2>
          {wpError ? (
            <p className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              Couldn&apos;t load work packages. Please try again.
            </p>
          ) : (
            <PurchaseRequestForm workPackages={workPackages} />
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">My requests</h2>
          {myError ? (
            <p className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              Couldn&apos;t load your requests. Please try again.
            </p>
          ) : !myRequests || myRequests.length === 0 ? (
            <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-400">
              You haven&apos;t raised any requests yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {myRequests.map((r) => {
                const wp = wpById.get(r.work_package_id);
                const status = r.status as PurchaseRequestStatus;
                return (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
                  >
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
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusPillClasses(status)}`}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
