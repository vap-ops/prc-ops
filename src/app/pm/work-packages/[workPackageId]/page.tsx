import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { DetailHeader } from "@/components/features/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { getCurrentPhotosForWorkPackage, type PhotoLogRow } from "@/lib/photos/current-photos";
import { PHASES, latestCreatedAt } from "@/lib/photos/phases";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { getDecisionHistoryForWorkPackage } from "@/lib/approvals/latest-decision";
import {
  APPROVAL_DECISION_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  formatThaiDateTime,
  formatThaiTime,
} from "@/lib/i18n/labels";
import { CARD, DETAIL_TITLE, SECTION_HEADING } from "@/lib/ui/classes";
import { PhaseProgressBar } from "@/components/features/phase-progress-bar";
import { approvalDecisionPillClasses, workPackageStatusPillClasses } from "@/lib/status-colors";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photo-strip";
import { LaborLogZone } from "@/components/features/labor-log-zone";
import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";
import { RecordDecisionForm } from "./record-decision-form";
import { HoldToggle } from "./hold-toggle";

interface PageProps {
  params: Promise<{ workPackageId: string }>;
}

export const metadata = { title: "ตรวจรายการงาน" };

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
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 54 header (operator mockup) via the spec-63 shell; the
          progress band below scrolls. */}
      <DetailHeader backHref="/pm" backLabel="กลับไปรายการรอตรวจ">
        <p className="truncate text-xs text-zinc-600">
          <span className="font-mono">{project.code}</span>
          <span className="mx-1">·</span>
          {project.name}
        </p>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-600">{wp.code}</p>
            {/* Spec 57: WP name never truncates — full wrap. */}
            <h1 className={DETAIL_TITLE}>{wp.name}</h1>
          </div>
          <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)} className="mt-1">
            {WORK_PACKAGE_STATUS_LABEL[wp.status as keyof typeof WORK_PACKAGE_STATUS_LABEL] ??
              wp.status}
          </StatusPill>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/requests?wp=${wp.id}`}
            className="w-fit text-xs font-medium text-blue-700 transition-colors hover:underline focus:outline-none focus-visible:underline"
          >
            สร้างคำขอซื้อ →
          </Link>
          {/* Spec 52: PM-and-up hold toggle — renders nothing on
                pending_approval/complete. */}
          <HoldToggle workPackageId={wp.id} status={wp.status} />
        </div>
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

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <section>
          <h2 className={SECTION_HEADING}>รูปถ่าย</h2>
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
          <h2 className={SECTION_HEADING}>บันทึกแรงงานรายวัน</h2>
          <LaborLogZone
            workPackageId={wp.id}
            revalidate={`/pm/work-packages/${workPackageId}`}
            roster={labor.roster}
            rows={labor.rows}
            showFlags
            locked={wp.status === "complete"}
          />
        </section>

        <section>
          <h2 className={SECTION_HEADING}>ประวัติการตรวจ</h2>
          {approvalsRows.length === 0 ? (
            <EmptyNotice className="text-zinc-600">ยังไม่มีการตรวจ</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2">
              {approvalsRows.map((a) => (
                <li key={a.id} className={CARD}>
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
          <h2 className={SECTION_HEADING}>บันทึกผลการตรวจ</h2>
          {wp.status === "pending_approval" ? (
            <RecordDecisionForm workPackageId={wp.id} />
          ) : (
            <EmptyNotice className="text-zinc-600">รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ</EmptyNotice>
          )}
        </section>
      </div>
    </PageShell>
  );
}

interface PhaseGalleryProps {
  label: string;
  photos: ReadonlyArray<PhotoLogRow>;
  signedUrls: ReadonlyMap<string, string>;
}

// Spec 54 timeline row — the read-only sibling of the SA uploader's
// treatment: status disc + bold label + count, rail-indented body with
// the last-updated line and the filmstrip (no add tile on the PM side).
function PhaseGallery({ label, photos, signedUrls }: PhaseGalleryProps) {
  const hasPhotos = photos.length > 0;
  const latest = latestCreatedAt(photos);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3">
        {hasPhotos ? (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
            <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : (
          <span
            aria-hidden
            className="h-7 w-7 shrink-0 rounded-full border-2 border-zinc-300 bg-white"
          />
        )}
        <h3 className="text-base font-bold text-zinc-900">
          {label}
          {hasPhotos ? (
            /* Spec 49: the strip hides its tail — announce the total. */
            <span className="ml-1.5 text-sm font-normal text-zinc-600">{photos.length} รูป</span>
          ) : null}
        </h3>
      </div>
      <div
        className={`ml-[13px] flex flex-col gap-2 border-l-2 pb-1 pl-5 ${
          hasPhotos ? "border-green-600" : "border-zinc-200"
        }`}
      >
        <p className="text-sm text-zinc-600">
          {latest ? `อัปเดตล่าสุด ${formatThaiTime(latest)}` : "ยังไม่มีรูป"}
        </p>
        {hasPhotos ? (
          /* Spec 49: filmstrip — page height stays constant per phase.
             Spec 50: the phase's loaded photos form one lightbox group. */
          <PhotoStrip>
            {(() => {
              const loaded = photos.flatMap((p) => {
                const u = signedUrls.get(p.id);
                return u ? [{ id: p.id, url: u }] : [];
              });
              const loadedUrls = loaded.map((l) => l.url);
              /* Spec 51: ids aligned with urls — markup follows navigation. */
              const loadedPhotoIds = loaded.map((l) => l.id);
              let loadedIndex = 0;
              return photos.map((p) => {
                const url = signedUrls.get(p.id);
                const groupIndex = url ? loadedIndex++ : 0;
                return (
                  <li key={p.id} className={PHOTO_STRIP_TILE}>
                    {url ? (
                      <ZoomablePhoto
                        src={url}
                        group={loadedUrls}
                        groupPhotoIds={loadedPhotoIds}
                        groupIndex={groupIndex}
                        photoId={p.id}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                        ไม่พร้อมแสดง
                      </div>
                    )}
                    {/* Spec 54: capture-time overlay (mockup tiles). */}
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
                      {formatThaiTime(p.captured_at_client ?? p.created_at)}
                    </span>
                  </li>
                );
              });
            })()}
          </PhotoStrip>
        ) : null}
      </div>
    </div>
  );
}
