"use server";

// Spec 270 U2b — grouping import server actions: dry-run (parse + validate +
// diff plan against the live project) and apply (re-validate, then call the
// import_wp_grouping RPC — the definer fn re-asserts the hard invariants).

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import {
  parseGroupingTemplate,
  toExistingWp,
  toRpcRows,
  validateGrouping,
  type GroupingIssue,
  type GroupingPlan,
} from "@/lib/work-packages/grouping-import";

export type GroupingDryRun = {
  rowCount: number;
  errors: GroupingIssue[];
  warnings: GroupingIssue[];
  plan: GroupingPlan | null;
};

export type GroupingApplyResult =
  | { ok: true; summary: Record<string, number> }
  | { ok: false; message: string };

async function loadExisting(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_packages")
    .select("id, code, name, is_group, parent_id")
    .eq("project_id", projectId)
    .order("code");
  if (error) throw new Error(error.message);
  return { supabase, existing: toExistingWp(data ?? []) };
}

export async function dryRunGroupingImport(
  projectId: string,
  text: string,
): Promise<GroupingDryRun> {
  await requireRole(["super_admin"]);
  const { existing } = await loadExisting(projectId);
  const { rows, errors: parseErrors } = parseGroupingTemplate(text);
  const res = validateGrouping(rows, existing);
  return {
    rowCount: rows.length,
    errors: [...parseErrors, ...res.errors],
    warnings: res.warnings,
    plan: parseErrors.length === 0 ? res.plan : null,
  };
}

export async function applyGroupingImport(
  projectId: string,
  text: string,
): Promise<GroupingApplyResult> {
  await requireRole(["super_admin"]);
  const { supabase, existing } = await loadExisting(projectId);

  // Stateless safety: apply re-runs the full dry-run and refuses on any error,
  // so a stale or never-validated paste can't reach the RPC.
  const { rows, errors: parseErrors } = parseGroupingTemplate(text);
  const res = validateGrouping(rows, existing);
  if (parseErrors.length > 0 || res.errors.length > 0) {
    return { ok: false, message: "ไฟล์ยังมีข้อผิดพลาด — กดตรวจสอบเพื่อดูรายการ" };
  }

  const { data, error } = await supabase.rpc("import_wp_grouping", {
    p_project_id: projectId,
    p_rows: toRpcRows(rows),
  });
  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/work-packages`);
  return { ok: true, summary: (data ?? {}) as Record<string, number> };
}
