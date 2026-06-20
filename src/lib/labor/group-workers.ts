// Spec 46 P1 — roster grouping for the capture picker. Own technicians
// first, DC workers grouped per contractor (sorted by contractor
// name). Inactive workers never appear in the picker.

import type { Database } from "@/lib/db/database.types";

type WorkerType = Database["public"]["Enums"]["worker_type"];

export type RosterWorker = {
  id: string;
  name: string;
  worker_type: WorkerType;
  contractor_id: string | null;
  active: boolean;
};

export type GroupedRoster = {
  own: RosterWorker[];
  dc: { contractorId: string | null; contractorName: string; workers: RosterWorker[] }[];
};

const UNKNOWN_CONTRACTOR_LABEL = "ไม่ระบุผู้รับเหมา";

export function groupRoster(
  workers: RosterWorker[],
  contractors: { id: string; name: string }[],
): GroupedRoster {
  const names = new Map(contractors.map((c) => [c.id, c.name]));
  const active = workers.filter((w) => w.active);

  const own = active.filter((w) => w.worker_type === "own");
  const dcByContractor = new Map<string, RosterWorker[]>();
  for (const w of active.filter((w) => w.worker_type === "dc")) {
    const key = w.contractor_id ?? "";
    const bucket = dcByContractor.get(key);
    if (bucket) bucket.push(w);
    else dcByContractor.set(key, [w]);
  }

  const dc = [...dcByContractor.entries()]
    .map(([contractorId, group]) => ({
      contractorId: contractorId || null,
      contractorName: names.get(contractorId) ?? UNKNOWN_CONTRACTOR_LABEL,
      workers: group,
    }))
    .sort((a, b) => a.contractorName.localeCompare(b.contractorName, "th"));

  return { own, dc };
}

// Spec 158 U1 — client-side search over the grouped picker so a site admin
// can find a DC in a long company-wide roster. Display-only: the caller keeps
// selection state keyed by worker id, so filtering never drops a tick.
export function filterRoster(roster: GroupedRoster, query: string): GroupedRoster {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return roster;
  const matches = (s: string) => s.toLocaleLowerCase().includes(q);
  return {
    own: roster.own.filter((w) => matches(w.name)),
    // A contractor-name hit keeps the whole crew; otherwise keep the workers
    // whose own name matches, and drop a crew left with none.
    dc: roster.dc
      .map((g) =>
        matches(g.contractorName) ? g : { ...g, workers: g.workers.filter((w) => matches(w.name)) },
      )
      .filter((g) => g.workers.length > 0),
  };
}
