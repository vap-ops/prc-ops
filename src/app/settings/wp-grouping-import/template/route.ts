// Spec 270 U2b — pre-filled grouping template download (TSV). One row per
// existing WP with OldCode = current code, so engineers only fill SubOf / new
// codes / new names and the rename+renumber join stays mistake-proof.

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { buildGroupingTemplate, toExistingWp } from "@/lib/work-packages/grouping-import";

export async function GET(request: Request): Promise<Response> {
  await requireRole(["super_admin"]);
  const projectId = new URL(request.url).searchParams.get("project");
  if (projectId === null || projectId === "") {
    return new Response("missing ?project", { status: 400 });
  }

  const supabase = await createClient();
  const [{ data: project }, { data: wps, error }] = await Promise.all([
    supabase.from("projects").select("code").eq("id", projectId).maybeSingle(),
    supabase
      .from("work_packages")
      .select("id, code, name, is_group, parent_id")
      .eq("project_id", projectId)
      .order("code"),
  ]);
  if (error) return new Response(error.message, { status: 500 });
  if (project === null) return new Response("unknown project", { status: 404 });

  const tsv = buildGroupingTemplate(toExistingWp(wps ?? []));
  return new Response(tsv, {
    headers: {
      "content-type": "text/tab-separated-values; charset=utf-8",
      "content-disposition": `attachment; filename="wp-grouping-${project.code}.tsv"`,
    },
  });
}
