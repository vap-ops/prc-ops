// Spec 270 U2b — งาน/งานย่อย grouping import (super_admin). Pick a project,
// download the pre-filled template (OldCode join keys), paste the completed
// file back, dry-run, then apply via the import_wp_grouping RPC. The heavy
// lifting is the pure lib (grouping-import.ts) + the definer RPC; this page is
// the thin operator surface. Reached by URL for now — the settings-hub card
// arrives with U3's roster work.

import Link from "next/link";

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

import { GroupingImportForm } from "./grouping-import-form";

export const metadata = { title: "นำเข้าโครงสร้างงาน (งาน/งานย่อย)" };

export default async function WpGroupingImportPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  await requireRole(["super_admin"]);
  const { project: projectId } = await searchParams;

  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("id, code, name").order("code");

  const selected = (projects ?? []).find((p) => p.id === projectId);

  let wpCount = 0;
  let groupCount = 0;
  if (selected !== undefined) {
    const { count } = await supabase
      .from("work_packages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", selected.id);
    wpCount = count ?? 0;
    const { count: groups } = await supabase
      .from("work_packages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", selected.id)
      .eq("is_group", true);
    groupCount = groups ?? 0;
  }

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">นำเข้าโครงสร้างงาน (งาน/งานย่อย)</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-ink-secondary text-xs">โครงการ</span>
            <select
              name="project"
              defaultValue={selected?.id ?? ""}
              className="border-edge bg-card text-ink rounded-xl border px-3 py-2 text-sm"
            >
              <option value="" disabled>
                เลือกโครงการ…
              </option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="border-edge bg-card text-ink rounded-xl border px-4 py-2 text-sm font-medium"
          >
            เลือก
          </button>
        </form>

        {selected !== undefined && (
          <>
            <section className="border-edge bg-card flex flex-col gap-2 rounded-xl border p-4">
              <p className="text-ink text-sm">
                {selected.code} มีงานทั้งหมด {wpCount} รายการ (งานกลุ่ม {groupCount})
              </p>
              <p className="text-ink-secondary text-xs">
                1) ดาวน์โหลดเทมเพลต → ทีมวิศวกรกรอก SubOf / รหัสใหม่ / ชื่อ (ห้ามลบแถว — คอลัมน์
                OldCode คือกุญแจจับคู่) → 2) วางกลับที่นี่ → ตรวจสอบ → นำเข้าจริง
              </p>
              <Link
                href={`/settings/wp-grouping-import/template?project=${selected.id}`}
                className="text-ink border-edge w-fit rounded-xl border px-4 py-2 text-sm font-medium"
              >
                ดาวน์โหลดเทมเพลต (.tsv)
              </Link>
            </section>

            <GroupingImportForm projectId={selected.id} />
          </>
        )}
      </section>
    </PageShell>
  );
}
