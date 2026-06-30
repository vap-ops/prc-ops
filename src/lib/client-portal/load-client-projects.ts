import "server-only";

// Spec 234 / ADR 0067 U2 — list the client's live projects. The "client reads
// own project" RLS arm (migration 035000) returns exactly the projects the
// caller has live access to. SAFE COLUMNS ONLY (no money).

import type { createClient } from "@/lib/db/server";
import type { ProjectStatus } from "@/lib/db/enums";

type RlsClient = Awaited<ReturnType<typeof createClient>>;

export interface ClientProjectSummary {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
}

export async function loadClientProjects(supabase: RlsClient): Promise<ClientProjectSummary[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, code, name, status")
    .order("code", { ascending: true });
  return (data ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status }));
}
