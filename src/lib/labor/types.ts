// Spec 65 — LaborDisplayRow moved here from
// components/features/labor-log-zone.tsx so server-only lib code
// (fetch-zone-data.ts) no longer imports a type from a client component.
// The component re-exports it, so pre-spec-65 import sites keep working.
//
// PRESENCE-ONLY BY CONSTRUCTION: no rate or cost fields (spec 46).

import type { Database } from "@/lib/db/database.types";

type DayFraction = Database["public"]["Enums"]["day_fraction"];

export type LaborDisplayRow = {
  id: string;
  workDate: string;
  workerName: string;
  fraction: DayFraction;
  selfLogged: boolean;
};
