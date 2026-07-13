// Spec 306 U1 — printable QR badges for the morning-talk scan check-in. One
// card per active worker on the SA's projects: name + PRC code + a QR whose
// payload is the worker id (opaque — a scan only means something inside an
// authenticated SA session on a visible project; it authenticates nobody).
// ?worker=<id> narrows to a single card for a reprint.
// Spec 313 U1: moved with its /team parent (back chip → /team).
import QRCode from "qrcode";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { buildBadgeGroups } from "@/lib/sa/badges";
import { fetchWorkerBadgeCodes } from "@/lib/sa/badge-codes";
import { BadgeSheet, type BadgeSheetGroup } from "@/components/features/sa/badge-sheet";

export const metadata = { title: "บัตรช่าง" };

interface BadgesPageProps {
  searchParams: Promise<{ worker?: string | string[] }>;
}

export default async function SaCrewBadgesPage({ searchParams }: BadgesPageProps) {
  await requireRole(["site_admin", "super_admin"]);
  const { worker } = await searchParams;
  // Repeated/empty ?worker= must not collapse the sheet to the empty state —
  // anything but one non-empty value means "no reprint filter".
  const reprintWorkerId = typeof worker === "string" && worker.length > 0 ? worker : undefined;
  const supabase = await createClient();

  // Same RLS derivation as /team: the SA's visible work packages → their
  // projects → the active workers on those projects (granted columns only;
  // employee_id is service-role-walled and fetched via the badge-codes seam).
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("project_id")
    .eq("is_group", false);
  const projectIds = Array.from(new Set((wpRows ?? []).map((w) => w.project_id)));

  const [projectRes, workerRes] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, code, name").in("id", projectIds).order("code")
      : Promise.resolve({ data: null }),
    projectIds.length
      ? supabase
          .from("workers")
          .select("id, name, project_id")
          .eq("active", true)
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
  ]);
  const projects = projectRes.data ?? [];
  const workers = workerRes.data ?? [];

  const codes = await fetchWorkerBadgeCodes(workers.map((w) => w.id));
  const groups = buildBadgeGroups(workers, codes, projects, reprintWorkerId);

  const sheetGroups: BadgeSheetGroup[] = await Promise.all(
    groups.map(async (group) => ({
      project: group.project,
      badges: await Promise.all(
        group.badges.map(async (badge) => ({
          ...badge,
          svg: await QRCode.toString(badge.workerId, {
            type: "svg",
            margin: 1,
            width: 144,
            color: { dark: "#000000", light: "#ffffff" },
          }),
        })),
      ),
    })),
  );

  return (
    <PageShell>
      <div className="print:hidden">
        <DetailHeader backHref="/team" backLabel="กลับ">
          <h1 className={DETAIL_TITLE}>บัตรช่าง</h1>
        </DetailHeader>
      </div>
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6 print:p-0`}>
        {sheetGroups.length > 0 ? (
          <BadgeSheet groups={sheetGroups} />
        ) : (
          <p className="text-ink-muted text-sm">ยังไม่มีช่างในโครงการของคุณ</p>
        )}
      </section>
    </PageShell>
  );
}
