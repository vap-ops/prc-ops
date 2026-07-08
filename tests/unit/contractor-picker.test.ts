import { describe, expect, it } from "vitest";

import {
  pickableContractors,
  type PickableContractorRow,
} from "@/lib/work-packages/contractor-picker";

const row = (over: Partial<PickableContractorRow>): PickableContractorRow => ({
  id: "c-default",
  name: "ผู้รับเหมา",
  phone: null,
  status: "active",
  contractor_category: "contractor",
  ...over,
});

describe("pickableContractors", () => {
  it("offers active subcontractors", () => {
    const out = pickableContractors([row({ id: "a", name: "ช่างสุทิน" })], null);
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps probation subcontractors (only blacklisted is hidden)", () => {
    const out = pickableContractors([row({ id: "p", status: "probation" })], null);
    expect(out.map((c) => c.id)).toEqual(["p"]);
  });

  it("EXCLUDES dc (day-contract) workers — the P0 mis-pick guard", () => {
    const out = pickableContractors(
      [
        row({ id: "sub", contractor_category: "contractor" }),
        row({ id: "dc", contractor_category: "dc" }),
      ],
      null,
    );
    expect(out.map((c) => c.id)).toEqual(["sub"]);
  });

  it("EXCLUDES blacklisted subcontractors when none is assigned", () => {
    const out = pickableContractors([row({ id: "bl", status: "blacklisted" })], null);
    expect(out).toEqual([]);
  });

  it("KEEPS the currently-assigned contractor even if it is dc (legacy assignment never vanishes)", () => {
    const out = pickableContractors(
      [row({ id: "sub" }), row({ id: "legacy-dc", contractor_category: "dc" })],
      "legacy-dc",
    );
    expect(out.map((c) => c.id).sort()).toEqual(["legacy-dc", "sub"]);
  });

  it("KEEPS the currently-assigned contractor even if it is blacklisted", () => {
    const out = pickableContractors([row({ id: "bad", status: "blacklisted" })], "bad");
    expect(out.map((c) => c.id)).toEqual(["bad"]);
  });

  it("projects to {id,name,phone} only — no status/category leak into the option", () => {
    const out = pickableContractors([row({ id: "a", name: "X", phone: "081-000-0000" })], null);
    expect(out[0]).toEqual({ id: "a", name: "X", phone: "081-000-0000" });
  });
});
