import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import {
  getCurrentPhotosForWorkPackage,
  type PhotoLogRow,
  type PhotoPhase,
} from "@/lib/photos/current-photos";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { StatusPill } from "@/components/features/status-pill";
import { PurchaseRequestTracker } from "@/components/features/purchase-request-tracker";
import {
  APPROVAL_DECISION_LABEL,
  PHOTO_PHASE_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import {
  approvalDecisionPillClasses,
  purchaseRequestStatusPillClasses,
  workPackageStatusPillClasses,
  type PurchaseRequestStatus,
} from "@/lib/status-colors";
import { fetchAssignableStaff, fetchDisplayNames } from "@/lib/users/display-names";
import { WpAssignmentPanel } from "@/components/features/wp-assignment-panel";
import { PhaseUploader } from "./phase-uploader";

interface PageProps {
  params: Promise<{ projectId: string; workPackageId: string }>;
}

export const metadata = { title: "รูปถ่ายงาน" };

const PHASES: ReadonlyArray<{ phase: PhotoPhase; label: string }> = [
  // เตรียมงาน is the display label for the `before` enum value —
  // equipment and raw-material staging (spec 10). The DB enum is untouched.
  { phase: "before", label: PHOTO_PHASE_LABEL.before },
  { phase: "during", label: PHOTO_PHASE_LABEL.during },
  { phase: "after", label: PHOTO_PHASE_LABEL.after },
];

export default async function WorkPackagePhotoScreen({ params }: PageProps) {
  const { projectId, workPackageId } = await params;
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id, description, owner_id")
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp || wp.project_id !== projectId) {
    notFound();
  }

  // Spec 28: owner/team, approval history, and the attention strip all
  // come from data that already existed but was never shown here.
  const { data: memberRows } = await supabase
    .from("work_package_members")
    .select("user_id")
    .eq("work_package_id", wp.id);
  const memberIds = (memberRows ?? []).map((m) => m.user_id);

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

  const nameIds = Array.from(
    new Set(
      [wp.owner_id, ...memberIds, ...approvals.map((a) => a.decided_by)].filter(
        (id): id is string => typeof id === "string",
      ),
    ),
  );
  const displayNames = await fetchDisplayNames(nameIds, "[wp-detail]");

  const isAssigner = ctx.role === "project_manager" || ctx.role === "super_admin";
  const staff = isAssigner ? await fetchAssignableStaff("[wp-detail]") : [];

  // Spec 25: this WP's purchase requests render inline — the operator's
  // "delivery status must show inside each WP, not having to go to the
  // request page." Same RLS-decided visibility as /requests.
  const { data: wpRequests } = await supabase
    .from("purchase_requests")
    .select(
      "id, pr_number, item_description, quantity, unit, status, requested_at, decided_at, purchased_at, shipped_at, delivered_at, eta",
    )
    .eq("work_package_id", wp.id)
    .order("requested_at", { ascending: false });

  const openRequestCount = (wpRequests ?? []).filter(
    (r) => !["delivered", "rejected", "cancelled"].includes(r.status),
  ).length;

  const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
  ];
  const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

  return (
    <main className="min-h-screen bg-white pb-20 text-zinc-900 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      <header className="border-b border-zinc-300 px-5 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-1">
          <Link
            href={`/sa/projects/${projectId}`}
            className="w-fit text-xs font-medium text-blue-700 hover:underline focus:outline-none focus-visible:underline"
          >
            ← รายการงาน
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-zinc-600">{wp.code}</p>
              <h1 className="truncate text-xl font-semibold tracking-tight">{wp.name}</h1>
            </div>
            <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)} className="mt-1">
              {WORK_PACKAGE_STATUS_LABEL[wp.status as keyof typeof WORK_PACKAGE_STATUS_LABEL] ??
                wp.status}
            </StatusPill>
          </div>
          {/* Spec 28 Part B: at-a-glance completeness + accountability. */}
          <p className="text-xs text-zinc-600">
            รูป {PHASES.filter(({ phase }) => photosByPhase[phase].length > 0).length}/3 ช่วง
            <span className="mx-1 text-zinc-400">·</span>
            คำขอซื้อ {openRequestCount} ค้าง
          </p>
          <p className="text-xs text-zinc-600">
            ผู้รับผิดชอบ{" "}
            <span className="font-medium text-zinc-900">
              {wp.owner_id ? (displayNames.get(wp.owner_id) ?? "—") : "—"}
            </span>
            {memberIds.length > 0 ? (
              <>
                <span className="mx-1 text-zinc-400">·</span>
                ทีม{" "}
                <span className="text-zinc-900">
                  {memberIds
                    .map((id) => displayNames.get(id) ?? "—")
                    .slice(0, 4)
                    .join(", ")}
                  {memberIds.length > 4 ? ` +${memberIds.length - 4}` : ""}
                </span>
              </>
            ) : null}
          </p>
          <Link
            href={`/requests?wp=${wp.id}`}
            className="w-fit text-xs font-medium text-blue-700 transition-colors hover:underline focus:outline-none focus-visible:underline"
          >
            สร้างคำขอซื้อ →
          </Link>
          {isAssigner ? (
            <WpAssignmentPanel
              projectId={wp.project_id}
              workPackageId={wp.id}
              staff={staff}
              ownerId={wp.owner_id}
              memberIds={memberIds}
            />
          ) : null}
        </div>
      </header>

      {attention ? (
        <div className="border-b border-zinc-300 px-5 py-3">
          <div
            className={`mx-auto max-w-2xl rounded-md border px-3 py-2 ${
              attention.decision === "rejected"
                ? "border-red-300 bg-red-50"
                : "border-amber-400 bg-amber-50"
            }`}
            role="alert"
          >
            <p
              className={`text-xs font-semibold ${
                attention.decision === "rejected" ? "text-red-900" : "text-amber-900"
              }`}
            >
              {APPROVAL_DECISION_LABEL[attention.decision]}
              <span className="mx-1 font-normal">·</span>
              <span className="font-normal">
                {displayNames.get(attention.decided_by) ?? "—"} ·{" "}
                {formatThaiDateTime(attention.decided_at)}
              </span>
            </p>
            {attention.comment ? (
              <p
                className={`mt-1 text-sm whitespace-pre-wrap ${
                  attention.decision === "rejected" ? "text-red-800" : "text-amber-800"
                }`}
              >
                {attention.comment}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Spec 28 Part C: single column on phones (photos first — the
          SA's job); ≥md two columns — photos wide left, facts right.
          max width steps up to 4xl ONLY at md so phones keep the
          familiar 2xl measure. */}
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-6 px-5 py-6 md:max-w-4xl md:grid-cols-[1.6fr_1fr] md:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {PHASES.map(({ phase, label }) => (
            <PhaseUploader
              key={phase}
              projectId={wp.project_id}
              workPackageId={wp.id}
              phase={phase}
              label={label}
              photos={photosByPhase[phase].map((p) => ({
                id: p.id,
                url: signedUrls.get(p.id) ?? null,
              }))}
            />
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {wp.description ? (
            <details className="rounded-lg border border-zinc-300 bg-white px-4 py-3 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
                รายละเอียดงาน
              </summary>
              <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-700">{wp.description}</p>
            </details>
          ) : null}
          {(wpRequests ?? []).length > 0 ? (
            <section>
              <h2 className="mb-2 text-base font-semibold text-zinc-900">คำขอซื้อของงานนี้</h2>
              <ul className="flex flex-col gap-2">
                {(wpRequests ?? []).map((r) => {
                  const status = r.status as PurchaseRequestStatus;
                  return (
                    <li
                      key={r.id}
                      className="rounded-lg border border-zinc-300 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-sm text-zinc-900">
                          <span className="mr-1.5 font-mono text-xs text-zinc-500">
                            PR-{String(r.pr_number).padStart(4, "0")}
                          </span>
                          {r.item_description}
                          <span className="mx-2 text-zinc-400">·</span>
                          <span className="text-zinc-700">
                            {r.quantity} {r.unit}
                          </span>
                        </p>
                        <StatusPill pillClasses={purchaseRequestStatusPillClasses(status)}>
                          {PURCHASE_REQUEST_STATUS_LABEL[status]}
                        </StatusPill>
                      </div>
                      <div className="mt-2">
                        <PurchaseRequestTracker
                          status={status}
                          requestedAt={r.requested_at}
                          decidedAt={r.decided_at}
                          purchasedAt={r.purchased_at}
                          shippedAt={r.shipped_at}
                          deliveredAt={r.delivered_at}
                          eta={r.eta}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Link
                href={`/requests?wp=${wp.id}`}
                className="mt-2 inline-flex text-xs font-medium text-blue-700 transition-colors hover:underline focus:outline-none focus-visible:underline"
              >
                ดูรายละเอียดคำขอซื้อทั้งหมด →
              </Link>
            </section>
          ) : null}
          {approvals.length > 0 ? (
            <details className="rounded-lg border border-zinc-300 bg-white px-4 py-3 shadow-sm">
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
    </main>
  );
}
