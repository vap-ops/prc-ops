// Spec 159 U1 — subcontractor (category=contractor) reads "ผู้รับเหมาช่วง"
// consistently, distinct from the general-WP "ผู้รับเหมา" (left generic) and
// from DC. Source-guard in the house style (mirrors nav-back-affordance.test.ts).
//
// IMPORTANT: "ผู้รับเหมา" is a SUBSTRING of "ผู้รับเหมาช่วง", so a useful guard
// asserts presence-of-ช่วง and absence-of-the-exact-old-merged-string — never
// absence-of-"ผู้รับเหมา".

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUBCONTRACTOR_LABEL } from "@/lib/i18n/labels";

const reads = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const SUBCONTRACTOR_SURFACES = [
  "src/components/features/contacts/contacts-tabs.tsx",
  // Spec 168: the crews page split; the subcontractor list is its own page now.
  "src/app/contacts/subcontractors/page.tsx",
  "src/app/contacts/[type]/[id]/page.tsx",
  // Settings-hub regroup (2026-07-03): the settings entry list moved from
  // page.tsx into the sections config — the SSOT usage lives there now.
  "src/app/settings/sections.ts",
];

describe("subcontractor label (spec 159 U1)", () => {
  it("SSOT term is ผู้รับเหมาช่วง", () => {
    expect(SUBCONTRACTOR_LABEL).toBe("ผู้รับเหมาช่วง");
  });

  // SSOT usage: each surface must reference the shared constant, not a hardcoded
  // copy of the Thai literal — that's what keeps the term from drifting.
  it.each(SUBCONTRACTOR_SURFACES)("%s uses the SUBCONTRACTOR_LABEL constant", (file) => {
    expect(reads(file)).toContain("SUBCONTRACTOR_LABEL");
  });

  it("the settings crews door no longer merges the two as ผู้รับเหมา/DC", () => {
    expect(reads("src/app/settings/sections.ts")).not.toContain("ผู้รับเหมา/DC");
  });
});
