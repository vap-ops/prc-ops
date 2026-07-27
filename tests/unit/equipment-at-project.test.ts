// Spec 368 U1 — which equipment is at a given project's store.
//
// Operator, 2026-07-28: the 64 tools "are supposed to be items in the store of
// the active project โพธิ์ทอง", and "all equipment will be transported to a new
// site soon". That second half is why this derives from `equipment_movements`
// rather than turning tools into stock rows: stock is per-project with **no
// project-to-project transfer** anywhere in the schema (every stock routine was
// checked), so stock-shaped tools would be stranded when โพธิ์ทอง closes.
// `deployed` already carries a project_id and the DB CHECK enforces
// `(project_id IS NOT NULL) = (kind = 'deployed')`, so "at this site" is a
// movement, and the site move is one more movement.

import { describe, expect, it } from "vitest";
import { equipmentAtProject } from "@/lib/equipment/at-project";

const PROJECT = "p1";
const OTHER = "p2";

const mv = (itemId: string, kind: string, projectId: string | null, occurredAt: string) => ({
  itemId,
  kind: kind as "received" | "deployed" | "returned" | "maintenance" | "lost",
  projectId,
  occurredAt,
});

describe("equipmentAtProject", () => {
  it("includes an item whose LATEST movement is deployed to this project", () => {
    const out = equipmentAtProject([mv("a", "deployed", PROJECT, "2026-07-01T00:00:00Z")], PROJECT);
    expect(out).toEqual(new Set(["a"]));
  });

  it("excludes an item deployed to a DIFFERENT project", () => {
    const out = equipmentAtProject([mv("a", "deployed", OTHER, "2026-07-01T00:00:00Z")], PROJECT);
    expect(out.size).toBe(0);
  });

  // The whole point of the site move: a later deployment elsewhere wins, so the
  // tool leaves this store the moment it is recorded at the new site.
  it("respects the LATEST movement when an item was moved on", () => {
    const out = equipmentAtProject(
      [
        mv("a", "deployed", PROJECT, "2026-07-01T00:00:00Z"),
        mv("a", "deployed", OTHER, "2026-07-20T00:00:00Z"),
      ],
      PROJECT,
    );
    expect(out.size).toBe(0);
  });

  it("drops an item that came back off site (returned / maintenance / lost)", () => {
    for (const kind of ["returned", "maintenance", "lost"]) {
      const out = equipmentAtProject(
        [
          mv("a", "deployed", PROJECT, "2026-07-01T00:00:00Z"),
          mv("a", kind, null, "2026-07-20T00:00:00Z"),
        ],
        PROJECT,
      );
      expect(out.size, kind).toBe(0);
    }
  });

  // 63 of 64 live items have NO movement at all — that is the original bug, and
  // an item with no history must not silently appear at an arbitrary site.
  it("excludes an item with no movements at all", () => {
    expect(equipmentAtProject([], PROJECT).size).toBe(0);
  });
});
