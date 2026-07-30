// Writing failing test first.
//
// Spec 376 U2 — the `คลังหน้างาน` cluster on the project hub: two labeled store
// doors, ของเข้า first.
//
// ⚠️ ONE door per destination per surface (spec 313 U3). The cluster REPLACES the
// two header chips, so the page pins below assert the hub builds NO store/incoming
// href any more — exact-zero, or a re-added chip slips through.
// ⚠️ Destinations, not actions: เบิก stays on `/sa` (the spec 375 U3 custody pair)
// and นับสต็อก is inside the คลัง page, so neither earns a tile here.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StoreCluster } from "@/components/features/projects/store-cluster";
import { STORE_CLUSTER_HEADING, STORE_INCOMING_HEADING, STORE_LABEL } from "@/lib/i18n/labels";

const CLUSTER = "src/components/features/projects/store-cluster.tsx";
const HUB = "src/app/projects/[projectId]/page.tsx";

// Comments are prose ABOUT the code — a rationale that names `incomingHref` must
// not satisfy (or defeat) a pin on what the code DOES.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const read = (p: string) => stripComments(readFileSync(p, "utf8"));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("<StoreCluster> (spec 376 U2)", () => {
  it("names the cluster once, over both doors", () => {
    render(<StoreCluster projectId="p1" />);
    expect(screen.getByRole("heading", { name: STORE_CLUSTER_HEADING })).toBeInTheDocument();
  });

  it("leads with receiving — 153 views/14d against the store's 11", () => {
    render(<StoreCluster projectId="p1" />);
    const links = screen.getAllByRole("link");
    // Exactly two: นับสต็อก lives inside the คลัง page, not as a third tile.
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName(STORE_INCOMING_HEADING);
    expect(links[1]).toHaveAccessibleName(STORE_LABEL);
  });

  it("sends each door to its project-scoped route", () => {
    render(<StoreCluster projectId="p1" />);
    expect(screen.getByRole("link", { name: STORE_INCOMING_HEADING })).toHaveAttribute(
      "href",
      "/projects/p1/incoming",
    );
    expect(screen.getByRole("link", { name: STORE_LABEL })).toHaveAttribute(
      "href",
      "/projects/p1/store",
    );
  });

  it("gives both doors the 44px gloved-hands tap floor", () => {
    render(<StoreCluster projectId="p1" />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toMatch(/\bmin-h-11\b/);
    }
  });

  it("draws all three terms from the labels SSOT, never re-literalled", () => {
    const src = read(CLUSTER);
    // import + exactly one use each.
    for (const name of ["STORE_CLUSTER_HEADING", "STORE_INCOMING_HEADING", "STORE_LABEL"]) {
      expect(count(src, name), name).toBe(2);
    }
    // …and no Thai survives in the code itself (rule 7 / labels SSOT): a second
    // copy of คลัง here is how one term becomes two.
    for (const literal of [STORE_CLUSTER_HEADING, STORE_INCOMING_HEADING, STORE_LABEL]) {
      expect(count(src, literal), literal).toBe(0);
    }
  });
});

describe("the project hub mounts the cluster and retires the two icon chips", () => {
  it("mounts it behind the store surfaces' existing canSeeStore gate", () => {
    const src = read(HUB);
    // import + mount.
    expect(count(src, "StoreCluster")).toBeGreaterThanOrEqual(2);
    // Spec 376 forward-compat: gate through the EXISTING named predicate, never an
    // inline role literal — a future `storekeeper` enum value must be a role-set
    // add, not a rework of this page.
    expect(src).toMatch(/canSeeStore\s*\?\s*<StoreCluster\s+projectId=\{project\.id\}\s*\/>/);
  });

  it("places it in the body, above the รายการงาน list", () => {
    const src = read(HUB);
    const mount = src.indexOf("<StoreCluster");
    const list = src.indexOf('id="work-packages"');
    expect(mount).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(list);
  });

  it("no longer builds a store or incoming door itself (spec 313 U3: one door each)", () => {
    const src = read(HUB);
    // Zero, not "fewer": the cluster owns both destinations now, so the hub needs
    // neither href helper nor either label. Re-adding a chip reds this.
    expect(count(src, "incomingHref")).toBe(0);
    expect(count(src, "storeHref")).toBe(0);
    expect(count(src, "STORE_INCOMING_HEADING")).toBe(0);
    expect(count(src, "STORE_LABEL")).toBe(0);
  });
});
