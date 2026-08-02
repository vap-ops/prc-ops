import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { SECTION_HEADING } from "@/lib/ui/classes";
import { createClient } from "@/lib/db/server";
import { requireRole } from "@/lib/auth/require-role";
import { buildMappingSuggestions } from "@/lib/wp-catalog/mapping-suggestions";
import vol2Names from "@/lib/wp-catalog/vol2-names.json";
import {
  MappingList,
  type MappingItemOption,
  type MappingRowData,
} from "@/components/features/wp-catalog/mapping-list";

export const metadata = { title: "จับคู่งานกับแคตตาล็อก" };

// Spec 389 U4 — the PD mapping surface for LEGACY projects: pair each existing
// WP with its firm-wide work-type (wp_catalog_items) so its photos can serve as
// ตัวอย่างงาน on every project. New catalogue-seeded projects never need this
// page (mapped at birth). PD-tier only — same set as the RPC's gate
// (affordance == action == RPC, the three-layer rule).
export default async function CatalogMappingPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireRole(["project_director", "super_admin"]);
  const { projectId } = await params;

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: wps, error: wpErr }, { data: items, error: itemErr }] = await Promise.all([
    supabase
      .from("work_packages")
      .select("id, code, name, is_group, wp_catalog_item_id")
      .eq("project_id", projectId)
      .order("code"),
    supabase
      .from("wp_catalog_items")
      .select("id, code, name, is_group, source_note")
      .eq("is_active", true)
      .order("code"),
  ]);

  // a read failure must NOT render as the "everything mapped" success empty
  // state — the silent-success class
  if (wpErr || itemErr) {
    return (
      <PageShell>
        <DetailHeader backHref={`/projects/${project.id}`} backLabel="กลับไปโครงการ">
          จับคู่งานกับแคตตาล็อก
        </DetailHeader>
        <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
          <p role="alert" className="text-body text-danger-ink">
            โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้านี้
          </p>
        </section>
      </PageShell>
    );
  }

  const suggestions = buildMappingSuggestions(
    (wps ?? []).map((w) => ({ id: w.id, code: w.code, name: w.name, is_group: w.is_group })),
    (items ?? []).map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      is_group: i.is_group,
      source_note: i.source_note,
    })),
    vol2Names as Record<string, string>,
  );

  const rows: MappingRowData[] = (wps ?? []).map((w) => {
    const s = w.wp_catalog_item_id ? null : (suggestions.get(w.id) ?? null);
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      isGroup: w.is_group,
      currentItemId: w.wp_catalog_item_id,
      suggestionItemId: s?.itemId ?? null,
      suggestionBasis: s?.basis ?? null,
    };
  });

  const options: MappingItemOption[] = (items ?? []).map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    isGroup: i.is_group,
  }));

  return (
    <PageShell>
      <DetailHeader backHref={`/projects/${project.id}`} backLabel="กลับไปโครงการ">
        จับคู่งานกับแคตตาล็อก
      </DetailHeader>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h1 className={SECTION_HEADING}>{project.name}</h1>
        <p className="text-body text-ink-secondary mb-4">
          จับคู่งานของโครงการนี้กับงานมาตรฐานในแคตตาล็อก
          เพื่อให้รูปถ่ายของงานนี้ใช้เป็นตัวอย่างในโครงการอื่นได้
        </p>
        <MappingList projectId={project.id} rows={rows} items={options} />
      </section>
    </PageShell>
  );
}
