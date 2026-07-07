// Writing failing test first.
//
// Spec 275 U4 — RentalVarianceList: the read-only agreement variance roll-up on
// /equipment/rentals (money, back office). Per agreement it shows the three
// reconciled figures (committed / charged-to-WP / paid-to-vendor) and the recovery
// flag. Presentation only — the page computes each RentalVariance via the pure
// helper and feeds it here.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RentalVarianceList } from "@/components/features/equipment/rental-variance-list";

const agreements = [
  {
    id: "b1",
    label: "บ.เครนไทย · ฿90,000.00/เดือน · เริ่ม 1 ก.ค. 2569 · ตลอดโครงการ (จนกว่าจะคืน)",
    variance: {
      chargedToWp: 9000,
      paidToVendor: 8000,
      committed: 7500,
      flag: "over_recovery" as const,
    },
  },
];

describe("RentalVarianceList", () => {
  it("shows each agreement's three figures and the recovery flag", () => {
    render(<RentalVarianceList agreements={agreements} />);
    const region = within(screen.getByRole("region", { name: /ส่วนต่างค่าเช่า/ }));
    expect(region.getByText(/บ.เครนไทย/)).toBeInTheDocument();
    expect(region.getByText("฿9,000.00")).toBeInTheDocument(); // charged
    expect(region.getByText("฿8,000.00")).toBeInTheDocument(); // paid
    expect(region.getByText("฿7,500.00")).toBeInTheDocument(); // committed
    // over-recovery = PRC margin
    expect(region.getByText(/กำไร/)).toBeInTheDocument();
  });

  it("marks an under-recovery agreement as a loss", () => {
    render(
      <RentalVarianceList
        agreements={[
          {
            id: "b2",
            label: "บ.นั่งร้าน",
            variance: {
              chargedToWp: 3000,
              paidToVendor: 5000,
              committed: 5000,
              flag: "under_recovery" as const,
            },
          },
        ]}
      />,
    );
    expect(screen.getByText(/ขาดทุน/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no agreements", () => {
    render(<RentalVarianceList agreements={[]} />);
    expect(screen.getByText(/ยังไม่มีสัญญาเช่า/)).toBeInTheDocument();
  });
});
