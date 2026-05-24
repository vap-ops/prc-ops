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

interface PageProps {
  params: Promise<{ projectId: string; workPackageId: string }>;
}

const PHASES: ReadonlyArray<{ phase: PhotoPhase; label: string }> = [
  { phase: "before", label: "Before" },
  { phase: "during", label: "During" },
  { phase: "after", label: "After" },
];

const WP_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  on_hold: "On hold",
  complete: "Complete",
  pending_approval: "Pending approval",
};

export default async function WorkPackagePhotoScreen({ params }: PageProps) {
  const { projectId, workPackageId } = await params;
  await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id")
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp || wp.project_id !== projectId) {
    notFound();
  }

  const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
  ];
  const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-1">
          <Link
            href={`/sa/projects/${projectId}`}
            className="w-fit text-xs text-zinc-500 hover:text-zinc-300 focus:outline-none focus-visible:underline"
          >
            ← Work packages
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-zinc-500">{wp.code}</p>
              <h1 className="truncate text-lg font-semibold tracking-tight">{wp.name}</h1>
            </div>
            <span className="mt-1 shrink-0 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
              {WP_STATUS_LABEL[wp.status] ?? wp.status}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-6">
        {PHASES.map(({ phase, label }) => (
          <PhaseSection
            key={phase}
            label={label}
            photos={photosByPhase[phase]}
            signedUrls={signedUrls}
          />
        ))}
      </div>
    </main>
  );
}

interface PhaseSectionProps {
  label: string;
  photos: ReadonlyArray<PhotoLogRow>;
  signedUrls: ReadonlyMap<string, string>;
}

function PhaseSection({ label, photos, signedUrls }: PhaseSectionProps) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-zinc-400">{label}</h2>
      {photos.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500">
          No {label.toLowerCase()} photos yet.
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
                  // Plain <img> in PR 1 — using next/image with signed
                  // Supabase URLs would require remotePatterns config in
                  // next.config.* for the Storage host. PR 2 may revisit.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                    unavailable
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
