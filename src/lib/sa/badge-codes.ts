// Spec 306 U1 — employee_id lookup for the badge sheet. workers.employee_id is
// column-walled to service_role (the workers PII wall), so the RLS session that
// already authorized the roster read cannot select it. Same seam as spec 296
// U3 / 301 U1: the caller's RLS read IS the authorization; the admin client
// only fetches the walled column for those already-visible worker ids.
import "server-only";

import { createClient as createAdminClient } from "@/lib/db/admin";

export async function fetchWorkerBadgeCodes(
  workerIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  if (workerIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, employee_id")
    .in("id", [...workerIds]);
  if (error) throw new Error(`badge-codes: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.employee_id) map.set(row.id, row.employee_id);
  }
  return map;
}
