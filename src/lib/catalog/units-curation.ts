// Spec 361 U8 — the pure half of the หน่วยนับ curation screen: fold the live
// item usage onto the managed list (`catalog_units`, spec 223 / ADR 0066) and
// separate out the strings that reached items through the `อื่น ๆ (ระบุเอง)`
// escape hatch without ever being managed.
//
// An INACTIVE managed unit stays MANAGED — retiring a unit must not make every
// item still carrying it look unmanaged, which would invite someone to
// "promote" a code that already exists and hit the RPC's uniqueness error.

import type { Database } from "@/lib/db/database.types";

export type UnitClass = Database["public"]["Enums"]["unit_class"];

/** Who added a unit through the app, or null when it came from the spec-223
 * seed (those rows carry no created_by). Operator 2026-07-26: an in-app
 * addition is a curation decision the manager should be able to verify. */
export interface UnitProvenance {
  name: string | null;
  /** ISO timestamp of the insert. */
  at: string;
}

export interface ManagedUnit {
  code: string;
  displayName: string;
  abbrShort: string | null;
  unitClass: UnitClass;
  sortOrder: number;
  isActive: boolean;
  addedBy?: UnitProvenance | null;
}

export interface ManagedUnitUsage extends ManagedUnit {
  /** Active catalog items carrying this unit. */
  usage: number;
}

export interface OffListUnit {
  unit: string;
  usage: number;
}

/**
 * @param managed catalog_units rows, already in display order
 * @param itemUnits one entry per ACTIVE catalog item — its `unit` text
 */
export function splitUnitUsage(
  managed: readonly ManagedUnit[],
  itemUnits: ReadonlyArray<string | null>,
): { managed: ManagedUnitUsage[]; offList: OffListUnit[] } {
  const counts = new Map<string, number>();
  for (const raw of itemUnits) {
    const unit = (raw ?? "").trim();
    if (unit === "") continue;
    counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }

  const managedCodes = new Set(managed.map((m) => m.code));
  const withUsage = managed.map((m) => ({ ...m, usage: counts.get(m.code) ?? 0 }));

  const offList = [...counts.entries()]
    .filter(([unit]) => !managedCodes.has(unit))
    .map(([unit, usage]) => ({ unit, usage }))
    // Most-used first: the ones worth promoting rise above the one-off typos.
    .sort((a, b) => b.usage - a.usage || a.unit.localeCompare(b.unit, "th"));

  return { managed: withUsage, offList };
}
