// Spec 392 U2a — ผังโซน: the project's zones, as a list.
//
// A zone is an axis that CROSSES the work-package tree (U1): a WP carries
// exactly one work-category, while a zone spans several trades, so "which
// trade" and "which area" cannot be the same column. This page is where the
// areas are defined; U2b adds the canvas that draws them, and U3 puts the zone
// on the work package itself.
//
// The LIST is not a preview of the canvas — it is the keyboard and
// screen-reader path to the same operations, because a canvas is opaque to
// both. Everything U2b will let a manager do by dragging must stay doable here.
//
// Gate: PM_ROLES, which is exactly `is_manager`'s live membership, so the page
// gate and the RPC gate cannot drift apart.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { PM_ROLES } from "@/lib/auth/role-home";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { safeBackHref } from "@/lib/nav/back-href";
import { projectHref } from "@/lib/nav/project-paths";
import { ZONE_LABEL, ZONE_MAP_LABEL } from "@/lib/i18n/labels";
import { buildZoneList, type ZoneRowInput } from "@/lib/zones/zone-list";
import { ZoneSheet } from "./zone-sheet";
import { DeleteZoneButton } from "./delete-zone-button";
import { CreateZoneMapButton } from "./create-zone-map-button";

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}

export const metadata = { title: ZONE_MAP_LABEL };

export default async function ZonesPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const { from } = await searchParams;
  const fromValue = Array.isArray(from) ? from[0] : from;

  const ctx = await requireRole(PM_ROLES);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: mapRows }, { data: zoneRows }, { data: wpRows }] = await Promise.all([
    supabase
      .from("project_zone_maps")
      .select("id, name, sheet_code, sheet_rev, background_path")
      .eq("project_id", project.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("project_zones")
      .select("id, map_id, code, name, shape, sort_order, parent_zone_id")
      .eq("project_id", project.id),
    // The per-zone count the list shows. Read as ids and tallied here rather
    // than as a grouped aggregate: PostgREST has no group-by, and the row count
    // per project is small enough that the join would buy nothing.
    supabase.from("work_packages").select("zone_id").eq("project_id", project.id),
  ]);

  const map = mapRows?.[0] ?? null;
  const counts: Record<string, number> = {};
  for (const row of wpRows ?? []) {
    if (row.zone_id) counts[row.zone_id] = (counts[row.zone_id] ?? 0) + 1;
  }

  const zonesOnMap: ZoneRowInput[] = (zoneRows ?? [])
    .filter((z) => map !== null && z.map_id === map.id)
    .map((z) => ({
      id: z.id,
      code: z.code,
      name: z.name,
      shape: z.shape,
      sortOrder: z.sort_order,
      parentZoneId: z.parent_zone_id,
    }));
  const rows = buildZoneList(zonesOnMap, counts);
  const zonedWpCount = rows.reduce((sum, row) => sum + row.workPackageCount, 0);

  return (
    <PageShell>
      <DetailHeader
        backHref={safeBackHref(fromValue, projectHref(project.id))}
        backLabel="ย้อนกลับ"
      >
        {/* text-ink-secondary, not ink-muted: this is readable copy. ink-muted is
            dividers / placeholder / disabled only (globals.css:87), and the
            design-doctrine ratchet counts every new use. */}
        <div className="text-meta text-ink-secondary font-mono">{project.code}</div>
        <h1 className="text-title text-ink font-semibold">{ZONE_MAP_LABEL}</h1>
        <p className="text-meta text-ink-secondary">
          {map
            ? `${rows.length} ${ZONE_LABEL} · งานที่ระบุโซนแล้ว ${zonedWpCount} รายการ`
            : "ยังไม่มีผังโซนในโครงการนี้"}
        </p>
      </DetailHeader>

      {/* PageShell owns the page's one <main> (spec 64) — hand-rolling a second
          one is what the design-doctrine scroller guard exists to catch. */}
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-4`}>
        {map === null ? (
          <div className="rounded-card border-edge bg-sunk px-4 py-5">
            <p className="text-body text-ink-secondary mb-4">
              สร้างผังโซนเพื่อแบ่งพื้นที่หน้างาน แล้วผูกงานแต่ละรายการเข้ากับโซน —
              โซนหนึ่งครอบได้หลายหมวดงาน ต่างจากหมวดงานที่งานหนึ่งมีได้หมวดเดียว
            </p>
            <CreateZoneMapButton projectId={project.id} />
          </div>
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-section text-ink font-semibold">{map.name}</h2>
              <ZoneSheet projectId={project.id} mapId={map.id} trigger={`+ เพิ่ม${ZONE_LABEL}`} />
            </div>

            {rows.length === 0 ? (
              <div className="rounded-card border-edge bg-sunk text-ink-secondary border px-4 py-3 text-sm">
                ยังไม่มีโซนในผังนี้ — เพิ่มโซนแรก เช่น พื้นลานด้านซ้าย หรือ ห้องถังน้ำดี
              </div>
            ) : (
              <ul className="rounded-card border-edge bg-card divide-edge divide-y border">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 px-4 py-2"
                    style={{ paddingLeft: `${16 + row.depth * 20}px` }}
                  >
                    <span className="text-meta text-ink-secondary font-mono">{row.code}</span>
                    <span className="text-body text-ink min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="text-meta text-ink-secondary shrink-0">
                      {row.workPackageCount} งาน
                    </span>
                    <ZoneSheet
                      projectId={project.id}
                      mapId={map.id}
                      zone={{ id: row.id, code: row.code, name: row.name }}
                      trigger="แก้ไข"
                    />
                    <DeleteZoneButton
                      projectId={project.id}
                      zoneId={row.id}
                      zoneName={row.name}
                      workPackageCount={row.workPackageCount}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <BottomTabBar role={ctx.role} />
    </PageShell>
  );
}
