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
  PHOTO_PHASE_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
} from "@/lib/i18n/labels";
import {
  purchaseRequestStatusPillClasses,
  workPackageStatusPillClasses,
  type PurchaseRequestStatus,
} from "@/lib/status-colors";
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
    .select("id, code, name, status, project_id")
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp || wp.project_id !== projectId) {
    notFound();
  }

  // Spec 25: this WP's purchase requests render inline — the operator's
  // "delivery status must show inside each WP, not having to go to the
  // request page." Same RLS-decided visibility as /requests.
  const { data: wpRequests } = await supabase
    .from("purchase_requests")
    .select(
      "id, item_description, quantity, unit, status, requested_at, decided_at, purchased_at, shipped_at, delivered_at, eta",
    )
    .eq("work_package_id", wp.id)
    .order("requested_at", { ascending: false });

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
          <Link
            href={`/requests?wp=${wp.id}`}
            className="w-fit text-xs font-medium text-blue-700 transition-colors hover:underline focus:outline-none focus-visible:underline"
          >
            สร้างคำขอซื้อ →
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-6">
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
    </main>
  );
}
