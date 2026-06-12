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
