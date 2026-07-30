// Spec 377 U2b — /projects/:projectId/work-packages/:workPackageId/brief: the
// tablet-first PD authoring editor for a leaf WP's ข้อมูลงาน. Gated PM_ROLES
// (mirrors the DB's is_manager() on every U2a RPC). A group WP, an unknown
// WP, or a WP in another project all fall to notFound — this route never
// leaks existence across those boundaries. Dedicated page, not a bottom
// sheet: the multi-section editor (draft fields + criteria + evidence slots
// + publish) needs a real canvas, matching the spec-245/spec-331 registry-
// editor precedent (ordering-templates/[templateId], settings/company-doc-
// types) rather than the sheet-first default (ui-conventions §7).

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { formatThaiDate, WP_BRIEF_LABEL } from "@/lib/i18n/labels";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { safeBackHref } from "@/lib/nav/back-href";
import { workPackageHref } from "@/lib/nav/project-paths";
import { WpBriefEditor } from "@/components/features/work-packages/wp-brief-editor";

export const metadata = { title: WP_BRIEF_LABEL };

interface PageProps {
  params: Promise<{ projectId: string; workPackageId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}

export default async function WpBriefEditorPage({ params, searchParams }: PageProps) {
  const { projectId, workPackageId } = await params;
  const { from } = await searchParams;
  await requireRole(PM_ROLES);

  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, is_group")
    .eq("id", workPackageId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!wp || wp.is_group) notFound();

  const { data: draftRow } = await supabase
    .from("wp_briefs")
    .select(
      "id, scope_included, scope_excluded, quantity, location, sheet_code, sheet_rev, display_config",
    )
    .eq("work_package_id", workPackageId)
    .maybeSingle();

  const draft = draftRow
    ? {
        id: draftRow.id,
        scopeIncluded: draftRow.scope_included,
        scopeExcluded: draftRow.scope_excluded,
        quantity: draftRow.quantity,
        location: draftRow.location,
        sheetCode: draftRow.sheet_code,
        sheetRev: draftRow.sheet_rev,
        // Round-tripped by the editor's save action UNCHANGED — no control
        // writes it yet (spec 377 §4.4/§7 item 2).
        displayConfig: draftRow.display_config,
      }
    : null;

  const [criteriaRows, slotRows, latestVersionRow] = await Promise.all([
    draft
      ? supabase
          .from("wp_brief_criteria")
          .select("id, body, sort_order")
          .eq("brief_id", draft.id)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; body: string; sort_order: number }[] }),
    draft
      ? supabase
          .from("wp_brief_evidence_slots")
          .select("id, label, criterion_id, sort_order")
          .eq("brief_id", draft.id)
          .order("sort_order", { ascending: true })
      : Promise.resolve({
          data: [] as {
            id: string;
            label: string;
            criterion_id: string | null;
            sort_order: number;
          }[],
        }),
    supabase
      .from("wp_brief_versions")
      .select("version, published_by, published_at")
      .eq("work_package_id", workPackageId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const criteria = (criteriaRows.data ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    sortOrder: c.sort_order,
  }));
  const evidenceSlots = (slotRows.data ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    criterionId: s.criterion_id,
    sortOrder: s.sort_order,
  }));

  let latestVersion: { version: number; publishedByName: string; publishedAt: string } | null =
    null;
  if (latestVersionRow.data) {
    const names = await fetchDisplayNames(
      [latestVersionRow.data.published_by],
      "wp-brief/latest-version",
    );
    latestVersion = {
      version: latestVersionRow.data.version,
      publishedByName: names.get(latestVersionRow.data.published_by) ?? "ไม่ทราบชื่อ",
      publishedAt: formatThaiDate(latestVersionRow.data.published_at),
    };
  }

  return (
    <PageShell>
      <DetailHeader
        backHref={safeBackHref(from, workPackageHref(projectId, workPackageId))}
        backLabel={wp.name}
      >
        <h1 className="text-title text-ink font-bold tracking-tight">{WP_BRIEF_LABEL}</h1>
        <p className="text-meta text-ink-secondary font-mono">{wp.code}</p>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <WpBriefEditor
          projectId={projectId}
          workPackageId={workPackageId}
          draft={draft}
          criteria={criteria}
          evidenceSlots={evidenceSlots}
          latestVersion={latestVersion}
        />
      </div>
    </PageShell>
  );
}
