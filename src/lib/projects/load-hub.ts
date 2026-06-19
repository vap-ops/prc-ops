// Spec 148 U4 — projects-hub data loader. The page ran projects → client names →
// (PM: suggested code + clients) in series. The PM-only create-sheet reads are
// independent of the row client-name lookup, so they join one Promise.all fan
// after the projects list. Behavior-preserving. Mirrors the spec-147 loaders.
// (Smallest payoff in the sweep; included for consistency.)

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

type Tbl = Database["public"]["Tables"];
type Db = SupabaseClient<Database>;
type ProjectRow = Pick<Tbl["projects"]["Row"], "id" | "code" | "name" | "status" | "client_id">;
type ClientRow = Pick<Tbl["clients"]["Row"], "id" | "name">;

export async function loadProjectsHub(supabase: Db, isPm: boolean) {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, code, name, status, client_id")
    .order("code", { ascending: true });

  const clientIds = [
    ...new Set((projects ?? []).map((p) => p.client_id).filter((id): id is string => id !== null)),
  ];

  // The fan: row client names (needs the project list's client ids) and the
  // PM-only create-sheet data (suggested code + full client list) are independent.
  const [clientRes, codeRes, allClientsRes] = await Promise.all([
    clientIds.length
      ? supabase.from("clients").select("id, name").in("id", clientIds)
      : Promise.resolve({ data: [] as ClientRow[] }),
    isPm ? supabase.rpc("suggest_project_code") : Promise.resolve({ data: "" }),
    isPm
      ? supabase.from("clients").select("id, name").order("name", { ascending: true })
      : Promise.resolve({ data: [] as ClientRow[] }),
  ]);

  const clientNames = new Map((clientRes.data ?? []).map((c) => [c.id, c.name]));

  return {
    projects: (projects ?? []) as ProjectRow[],
    error,
    clientNames,
    suggestedCode: codeRes.data ?? "",
    allClients: allClientsRes.data ?? [],
  };
}
