// Writing failing test first.
//
// Spec 327 U6 — the icon chip row (the idiom users picked at checkpoint 2:
// project-page ICON_CHIP chips on TOP, replacing the text door grids). Each
// door renders as a 44px icon-only chip whose accessible name is the door
// label (aria-label — the SSOT constants), href threads ?from back to the
// hosting surface, 📍 project doors hide without a project, managerOnly doors
// hide for the base tier.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcurementDoorChips } from "@/components/features/purchasing/procurement-door-chips";
import { LABOR_RATES_LABEL } from "@/lib/i18n/labels";
import { PROCUREMENT_STR_SECTIONS } from "@/lib/purchasing/procurement-home";

const SCOPE = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "scope")!;
const RESOURCES = PROCUREMENT_STR_SECTIONS.find((s) => s.key === "resources")!;

describe("ProcurementDoorChips", () => {
  it("renders each door as an icon chip named by its label, ?from-threaded", () => {
    render(
      <ProcurementDoorChips
        doors={SCOPE.doors}
        isManager={false}
        activeProjectId={null}
        from="/procurement/scope"
      />,
    );
    const requests = screen.getByRole("link", { name: "จัดซื้อ" });
    expect(requests.getAttribute("href")).toContain("/requests");
    expect(requests.getAttribute("href")).toContain("from=%2Fprocurement%2Fscope");
  });

  it("hides 📍 project doors without a project and shows them resolved with one", () => {
    const { rerender } = render(
      <ProcurementDoorChips
        doors={SCOPE.doors}
        isManager={false}
        activeProjectId={null}
        from="/procurement/scope"
      />,
    );
    expect(screen.queryByRole("link", { name: "แผนจัดหา" })).toBeNull();
    rerender(
      <ProcurementDoorChips
        doors={SCOPE.doors}
        isManager={false}
        activeProjectId="p1"
        from="/procurement/scope"
      />,
    );
    expect(screen.getByRole("link", { name: "แผนจัดหา" }).getAttribute("href")).toContain(
      "/projects/p1/supply-plan",
    );
  });

  it("filters managerOnly doors for the base tier", () => {
    const { rerender } = render(
      <ProcurementDoorChips
        doors={RESOURCES.doors}
        isManager={false}
        activeProjectId="p1"
        from="/procurement/resources"
      />,
    );
    expect(screen.queryByRole("link", { name: LABOR_RATES_LABEL })).toBeNull();
    rerender(
      <ProcurementDoorChips
        doors={RESOURCES.doors}
        isManager={true}
        activeProjectId="p1"
        from="/procurement/resources"
      />,
    );
    expect(screen.getByRole("link", { name: LABOR_RATES_LABEL })).toBeInTheDocument();
  });
});
