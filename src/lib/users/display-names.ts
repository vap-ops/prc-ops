import "server-only";

// Shared admin-client display-name resolver (spec 17). public.users RLS
// is "read self" + super_admin (ADR 0011), so server pages that need to
// show OTHER users' names (the PM queue's requester, the review screen's
// decider) resolve them via the admin client — only display names leave
// this module. Consolidates the per-page copies that lived in
// pm/requests/page.tsx and pm/work-packages/[workPackageId]/page.tsx.
//
// Failure is non-fatal by contract: callers render a fallback (email or
// em-dash) when an id is missing from the map.

import { createClient as createAdminClient } from "@/lib/db/admin";

export async function fetchDisplayNames(
  userIds: ReadonlyArray<string>,
  logTag: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (userIds.length === 0) return result;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("id", userIds as string[]);
  if (error) {
    console.error(`${logTag} failed to read display names`, error.message);
    return result;
  }
  for (const u of data ?? []) {
    if (u.full_name) result.set(u.id, u.full_name);
  }
  return result;
}
