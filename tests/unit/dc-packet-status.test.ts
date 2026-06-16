// Spec 131 U1 — the DC onboarding-packet completeness check. Required items
// differ by DC type (individual day-labor vs company firm). Pure; the PM page
// and the portal both render it. Insurance/house-reg are available docs but NOT
// required (don't over-ask of a day laborer).

import { describe, it, expect } from "vitest";
import {
  contractorPacketStatus,
  dcTypeOfSubtype,
  requiredFor,
  type DcPacket,
} from "@/lib/contacts/packet";

function full(over: Partial<DcPacket> = {}): DcPacket {
  return {
    idCard: true,
    bankBook: true,
    bank: true,
    consentPdpa: true,
    consentBackgroundCheck: true,
    emergencyContact: true,
    phone: true,
    companyCert: true,
    vatCert: true,
    ...over,
  };
}

describe("dcTypeOfSubtype", () => {
  it("maps dc_company → company, everything else → individual", () => {
    expect(dcTypeOfSubtype("dc_company")).toBe("company");
    expect(dcTypeOfSubtype("dc_regular")).toBe("individual");
    expect(dcTypeOfSubtype("dc_temporary")).toBe("individual");
    expect(dcTypeOfSubtype(null)).toBe("individual");
  });
});

describe("contractorPacketStatus", () => {
  it("an individual with the common set is complete", () => {
    const r = contractorPacketStatus(full(), "individual");
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("does NOT require company docs of an individual", () => {
    const r = contractorPacketStatus(full({ companyCert: false, vatCert: false }), "individual");
    expect(r.complete).toBe(true);
  });

  it("flags a missing common item with its label", () => {
    const r = contractorPacketStatus(full({ bankBook: false }), "individual");
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("สำเนาสมุดบัญชี");
  });

  it("requires consent (PDPA + background check) for everyone", () => {
    expect(contractorPacketStatus(full({ consentPdpa: false }), "individual").complete).toBe(false);
    expect(
      contractorPacketStatus(full({ consentBackgroundCheck: false }), "individual").complete,
    ).toBe(false);
  });

  it("requires emergency contact", () => {
    expect(contractorPacketStatus(full({ emergencyContact: false }), "individual").complete).toBe(
      false,
    );
  });

  it("a company additionally requires company cert + VAT cert", () => {
    const r = contractorPacketStatus(full({ companyCert: false }), "company");
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("หนังสือรับรองบริษัท");
  });

  it("requiredFor(company) is a superset of requiredFor(individual)", () => {
    const ind = requiredFor("individual").map((r) => r.key);
    const co = requiredFor("company").map((r) => r.key);
    for (const k of ind) expect(co).toContain(k);
    expect(co.length).toBeGreaterThan(ind.length);
  });
});
