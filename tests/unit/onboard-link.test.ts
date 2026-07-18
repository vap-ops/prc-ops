import { describe, it, expect } from "vitest";
import { technicianOnboardUrl } from "@/lib/register/onboard-link";

describe("technicianOnboardUrl", () => {
  it("builds a per-project, per-inviter self-onboard URL", () => {
    const url = technicianOnboardUrl("https://app.example.com", {
      projectId: "p1",
      siteLabel: "TFM โพธิ์ทอง",
      inviterId: "sa1",
    });
    const u = new URL(url);
    expect(u.pathname).toBe("/register/technician");
    expect(u.searchParams.get("project")).toBe("p1");
    expect(u.searchParams.get("site")).toBe("TFM โพธิ์ทอง");
    expect(u.searchParams.get("by")).toBe("sa1");
  });

  it("spec 328: carries the per-firm contractor param + firm display label when given", () => {
    const url = technicianOnboardUrl("https://app.example.com", {
      projectId: "p1",
      siteLabel: "TFM โพธิ์ทอง",
      inviterId: "sa1",
      contractorId: "c1",
      firmLabel: "ช่างอวย",
    });
    const u = new URL(url);
    expect(u.searchParams.get("contractor")).toBe("c1");
    expect(u.searchParams.get("firm")).toBe("ช่างอวย");
    expect(u.searchParams.get("project")).toBe("p1");
  });

  it("spec 328: omits contractor/firm params entirely on the PRC link", () => {
    const url = technicianOnboardUrl("https://app.example.com", {
      projectId: "p1",
      siteLabel: "TFM โพธิ์ทอง",
      inviterId: "sa1",
    });
    const u = new URL(url);
    expect(u.searchParams.has("contractor")).toBe(false);
    expect(u.searchParams.has("firm")).toBe(false);
  });

  it("URL-encodes the Thai site label safely", () => {
    const url = technicianOnboardUrl("https://app.example.com", {
      projectId: "p1",
      siteLabel: "บ้านคุณกฤษณ์",
      inviterId: "sa1",
    });
    expect(url).not.toContain(" ");
    expect(new URL(url).searchParams.get("site")).toBe("บ้านคุณกฤษณ์");
  });
});
