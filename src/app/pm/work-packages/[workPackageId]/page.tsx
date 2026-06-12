import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import {
  getCurrentPhotosForWorkPackage,
  type PhotoLogRow,
  type PhotoPhase,
} from "@/lib/photos/current-photos";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { getDecisionHistoryForWorkPackage } from "@/lib/approvals/latest-decision";
import {
  APPROVAL_DECISION_LABEL,
  PHOTO_PHASE_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import { approvalDecisionPillClasses, workPackageStatusPillClasses } from "@/lib/status-colors";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photo-strip";
import { LaborLogZone } from "@/components/features/labor-log-zone";
import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";
import { RecordDecisionForm } from "./record-decision-form";

interface PageProps {
  params: Promise<{ workPackageId: string }>;
}

export const metadata = { title: "ตรวจรายการงาน" };

const PHASES: ReadonlyArray<{ phase: PhotoPhase; label: string }> = [
  // เตรียมงาน is the display label for the `before` enum value —
  // equipment and raw-material staging (spec 10). The DB enum is untouched.
  { phase: "before", label: PHOTO_PHASE_LABEL.before },
  { phase: "during", label: PHOTO_PHASE_LABEL.during },
  { phase: "after", label: PHOTO_PHASE_LABEL.after },
];

export default async function WorkPackageReviewScreen({ params }: PageProps) {
  const { workPackageId } = await params;
  const ctx = await requireRole(["project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id")
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp) {
    notFound();
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", wp.project_id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
  ];
  const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

  // Decision history: newest first. RLS admits sa/pm/super to SELECT
  // approvals so the PM (and super_admin) can read every row for this
  // WP under their own session. Helper threads the Database type
  // through so a.decision is the enum union, not any.
  const approvalsRows = await getDecisionHistoryForWorkPackage(supabase, wp.id);

  // Spec 46: daily crew presence — PM sees the same presence-only zone
  // plus the self-log flags (costs live in P2's requireRole-gated view).
  const labor = await fetchLaborZoneData(supabase, wp.id);

  // public.users SELECT is gated to "users read self" + super_admin
  // (ADR 0011), so the SSR client can't resolve other PMs' names for
  // a non-super PM looking at the history. Use the admin client for
  // this narrow read — we're already past requireRole(pm|super), the
  // page is server-rendered, and only display names appear in the
  // result. Same shape as src/lib/photos/signed-urls.ts.
  const deciderIds = Array.from(new Set(approvalsRows.map((r) => r.decided_by)));
  const deciderNames = await fetchDisplayNames(deciderIds, "[pm/work-packages]");

  return (
    <main className="min-h-screen bg-zinc-50 pb-20 text-zinc-900 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      <header className="border-b border-zinc-200 bg-white px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-1`}>
          <Link
            href="/pm"
            className="w-fit text-xs font-medium text-blue-700 hover:underline focus:outline-none focus-visible:underline"
          >
            ← รายการรอตรวจ
          </Link>
          <p className="truncate text-xs text-zinc-600">
            <span className="font-mono">{project.code}</span>
            <span className="mx-1">·</span>
            {project.name}
          </p>
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

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">รูปถ่าย</h2>
          <div className="flex flex-col gap-5">
            {PHASES.map(({ phase, label }) => (
              <PhaseGallery
                key={phase}
                label={label}
                photos={photosByPhase[phase]}
                signedUrls={signedUrls}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">บันทึกแรงงานรายวัน</h2>
          <LaborLogZone
            projectId={wp.project_id}
            workPackageId={wp.id}
            revalidate={`/pm/work-packages/${workPackageId}`}
            roster={labor.roster}
            rows={labor.rows}
            showFlags
            locked={wp.status === "complete"}
          />
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">ประวัติการตรวจ</h2>
          {approvalsRows.length === 0 ? (
            <EmptyNotice className="text-zinc-600">ยังไม่มีการตรวจ</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2">
              {approvalsRows.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <StatusPill pillClasses={approvalDecisionPillClasses(a.decision)}>
                      {APPROVAL_DECISION_LABEL[a.decision]}
                    </StatusPill>
                    <span className="text-xs text-zinc-600">
                      {formatThaiDateTime(a.decided_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600">
                    {deciderNames.get(a.decided_by) ?? "ไม่ทราบชื่อผู้ตรวจ"}
                  </p>
                  {a.comment && (
                    <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-900">{a.comment}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">บันทึกผลการตรวจ</h2>
          {wp.status === "pending_approval" ? (
            <RecordDecisionForm workPackageId={wp.id} />
          ) : (
            <EmptyNotice className="text-zinc-600">รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ</EmptyNotice>
          )}
        </section>
      </div>
    </main>
  );
}

interface PhaseGalleryProps {
  label: string;
  photos: ReadonlyArray<PhotoLogRow>;
  signedUrls: ReadonlyMap<string, string>;
}

function PhaseGallery({ label, photos, signedUrls }: PhaseGalleryProps) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium tracking-wider text-zinc-600 uppercase">
        {label}
        {photos.length > 0 ? (
          /* Spec 49: the strip hides its tail — announce the total. */
          <span className="ml-1.5 font-normal normal-case">({photos.length})</span>
        ) : null}
      </h3>
      {photos.length === 0 ? (
        <EmptyNotice className="text-zinc-600">ไม่มีรูปช่วง{label}</EmptyNotice>
      ) : (
        /* Spec 49: filmstrip — page height stays constant per phase.
           Spec 50: the phase's loaded photos form one lightbox group. */
        <PhotoStrip>
          {(() => {
            const loadedUrls = photos.flatMap((p) => {
              const u = signedUrls.get(p.id);
              return u ? [u] : [];
            });
            let loadedIndex = 0;
            return photos.map((p) => {
              const url = signedUrls.get(p.id);
              const groupIndex = url ? loadedIndex++ : 0;
              return (
                <li key={p.id} className={PHOTO_STRIP_TILE}>
                  {url ? (
                    <ZoomablePhoto src={url} group={loadedUrls} groupIndex={groupIndex} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                      ไม่พร้อมแสดง
                    </div>
                  )}
                </li>
              );
            });
          })()}
        </PhotoStrip>
      )}
    </div>
  );
}
