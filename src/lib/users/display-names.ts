import "server-only";

// Shared admin-client display-name resolver (spec 17). public.users RLS
// is "read self" + super_admin (ADR 0011), so server pages that need to
// show OTHER users' names (the /requests pending band's requester line,
// the review screen's decider) resolve them via the admin client — only
// display names leave this module. Consumers: requests/page.tsx and
// pm/work-packages/[workPackageId]/page.tsx.
//
// Failure is non-fatal by contract: callers render a fallback (email or
// em-dash) when an id is missing from the map.

import { createClient as createAdminClient } from "@/lib/db/admin";

// Staff option list for assignment pickers (spec 28 / ADR 0032): id +
// display name of every requester-capable user. Same exposure class as
// fetchDisplayNames (names only), recorded in ADR 0032.
export interface StaffOption {
  id: string;
  name: string;
}

export async function fetchAssignableStaff(logTag: string): Promise<StaffOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("role", ["site_admin", "project_manager", "super_admin"])
    .order("full_name", { ascending: true });
  if (error) {
    console.error(`${logTag} failed to read assignable staff`, error.message);
    return [];
  }
  // public.users has no email column — the uuid head is the last-resort
  // label for never-named accounts (same fallback class as the cards).
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.full_name ?? u.id.slice(0, 8),
  }));
}

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
