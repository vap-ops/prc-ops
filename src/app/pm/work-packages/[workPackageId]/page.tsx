import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
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
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import type { Database } from "@/lib/db/database.types";
import { RecordDecisionForm } from "./record-decision-form";

type ApprovalDecision = Database["public"]["Enums"]["approval_decision"];

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

const DECISION_CLASSES: Record<ApprovalDecision, string> = {
  approved: "border-emerald-900/60 bg-emerald-950/40 text-emerald-200",
  rejected: "border-red-900/60 bg-red-950/40 text-red-200",
  needs_revision: "border-amber-900/60 bg-amber-950/40 text-amber-200",
};

export default async function WorkPackageReviewScreen({ params }: PageProps) {
  const { workPackageId } = await params;
  await requireRole(["project_manager", "super_admin"]);
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

  // public.users SELECT is gated to "users read self" + super_admin
  // (ADR 0011), so the SSR client can't resolve other PMs' names for
  // a non-super PM looking at the history. Use the admin client for
  // this narrow read — we're already past requireRole(pm|super), the
  // page is server-rendered, and only display names appear in the
  // result. Same shape as src/lib/photos/signed-urls.ts.
  const deciderIds = Array.from(new Set(approvalsRows.map((r) => r.decided_by)));
  const deciderNames = await fetchDeciderNames(deciderIds);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-1">
          <Link
            href="/pm"
            className="w-fit text-xs text-zinc-500 hover:text-zinc-300 focus:outline-none focus-visible:underline"
          >
            ← รายการรอตรวจ
          </Link>
          <p className="truncate text-xs text-zinc-500">
            <span className="font-mono">{project.code}</span>
            <span className="mx-1">·</span>
            {project.name}
          </p>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-zinc-500">{wp.code}</p>
              <h1 className="truncate text-lg font-semibold tracking-tight">{wp.name}</h1>
            </div>
            <span
              className={`mt-1 shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${workPackageStatusPillClasses(wp.status)}`}
            >
              {WORK_PACKAGE_STATUS_LABEL[wp.status as keyof typeof WORK_PACKAGE_STATUS_LABEL] ??
                wp.status}
            </span>
          </div>
          <Link
            href={`/requests?wp=${wp.id}`}
            className="w-fit text-xs text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            สร้างคำขอซื้อ →
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6">
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">รูปถ่าย</h2>
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
          <h2 className="mb-3 text-sm font-medium text-zinc-400">ประวัติการตรวจ</h2>
          {approvalsRows.length === 0 ? (
            <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500">
              ยังไม่มีการตรวจ
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {approvalsRows.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${DECISION_CLASSES[a.decision]}`}
                    >
                      {APPROVAL_DECISION_LABEL[a.decision]}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {formatThaiDateTime(a.decided_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    {deciderNames.get(a.decided_by) ?? "ไม่ทราบชื่อผู้ตรวจ"}
                  </p>
                  {a.comment && (
                    <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-200">{a.comment}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">บันทึกผลการตรวจ</h2>
          {wp.status === "pending_approval" ? (
            <RecordDecisionForm workPackageId={wp.id} />
          ) : (
            <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500">
              รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ
            </p>
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
      <h3 className="mb-2 text-xs font-medium tracking-wider text-zinc-500 uppercase">{label}</h3>
      {photos.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500">
          ไม่มีรูปช่วง{label}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => {
            const url = signedUrls.get(p.id);
            return (
              <li
                key={p.id}
                className="aspect-square overflow-hidden rounded-md border border-zinc-800 bg-zinc-900"
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                    ไม่พร้อมแสดง
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

async function fetchDeciderNames(userIds: ReadonlyArray<string>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (userIds.length === 0) return result;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("id", userIds as string[]);
  if (error) {
    console.error("[pm/work-packages] failed to read decider names", error.message);
    return result;
  }
  for (const u of data ?? []) {
    if (u.full_name) result.set(u.id, u.full_name);
  }
  return result;
}
