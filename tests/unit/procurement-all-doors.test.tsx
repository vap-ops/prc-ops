// Writing failing test first.
//
// Spec 327 U6c — the ทั้งหมด labeled door grid on หน้าหลัก: the rule-4 labeled
// path for every door once the section text grids retire (icon chips alone are
// not the only way in). Collapsed <details>; inside, the three STR groups
// render labeled icon rows — every door, ?from-threaded, 📍 doors resolved via
// the selection, managerOnly filtered.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcurementAllDoors } from "@/components/features/purchasing/procurement-all-doors";
import { LABOR_RATES_LABEL, SUPPLY_PLAN_LABEL } from "@/lib/i18n/labels";

describe("ProcurementAllDoors", () => {
  it("renders the three labeled STR groups with every visible door as a labeled link", () => {
    render(<ProcurementAllDoors isManager={false} activeProjectId="p1" from="/procurement" />);
    for (const group of ["ขอบเขต", "เวลา", "ทรัพยากร"]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    const requests = screen.getByRole("link", { name: /จัดซื้อ/ });
    expect(requests.getAttribute("href")).toContain("/requests");
    expect(requests.getAttribute("href")).toContain("from=%2Fprocurement");
    expect(screen.getByRole("link", { name: SUPPLY_PLAN_LABEL }).getAttribute("href")).toContain(
      "/projects/p1/supply-plan",
    );
  });

  it("filters managerOnly doors for the base tier and shows them for managers", () => {
    const { rerender } = render(
      <ProcurementAllDoors isManager={false} activeProjectId="p1" from="/procurement" />,
    );
    expect(screen.queryByRole("link", { name: LABOR_RATES_LABEL })).toBeNull();
    rerender(<ProcurementAllDoors isManager={true} activeProjectId="p1" from="/procurement" />);
    expect(screen.getByRole("link", { name: LABOR_RATES_LABEL })).toBeInTheDocument();
  });

  it("hides 📍 doors without a selection instead of dead-ending (§0)", () => {
    render(<ProcurementAllDoors isManager={false} activeProjectId={null} from="/procurement" />);
    expect(screen.queryByRole("link", { name: SUPPLY_PLAN_LABEL })).toBeNull();
  });
});
