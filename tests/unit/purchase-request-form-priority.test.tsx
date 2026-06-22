// Spec 21 — urgency as a segmented radio group. The load-bearing rules:
// native radios (platform a11y), all three priorities visible with Thai
// labels, "normal" preselected, and selection drives the same `priority`
// state the action receives.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

vi.mock("@/app/requests/actions", () => ({
  createPurchaseRequest: vi.fn(async () => ({ ok: true })),
}));

import {
  PurchaseRequestForm,
  type PurchaseRequestCatalogItem,
} from "@/components/features/purchasing/purchase-request-form";

const WP = { id: "00000000-0000-0000-0000-000000000001", code: "WP01", name: "งานปักฝัง" };
// Spec 180: the form needs a catalog (item entry is catalog-only); priority
// rendering is independent of the chosen item, so one item suffices here.
const CATALOG: PurchaseRequestCatalogItem[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    category: "paint",
    baseItem: "สี",
    specAttrs: null,
    unit: "แกลลอน",
  },
];

describe("PurchaseRequestForm priority segmented control (spec 21)", () => {
  it("renders all three priorities as radios with Thai labels, normal preselected", () => {
    render(
      <PurchaseRequestForm
        workPackage={WP}
        projectId="00000000-0000-0000-0000-000000000002"
        userId="00000000-0000-0000-0000-0000000000aa"
        catalogItems={CATALOG}
      />,
    );
    const normal = screen.getByRole("radio", { name: "ปกติ" });
    const urgent = screen.getByRole("radio", { name: "ด่วน" });
    const critical = screen.getByRole("radio", { name: "ด่วนมาก" });
    expect(normal).toBeChecked();
    expect(urgent).not.toBeChecked();
    expect(critical).not.toBeChecked();
  });

  it("selecting ด่วนมาก checks it and unchecks the rest", async () => {
    const user = userEvent.setup();
    render(
      <PurchaseRequestForm
        workPackage={WP}
        projectId="00000000-0000-0000-0000-000000000002"
        userId="00000000-0000-0000-0000-0000000000aa"
        catalogItems={CATALOG}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "ด่วนมาก" }));
    expect(screen.getByRole("radio", { name: "ด่วนมาก" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "ปกติ" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "ด่วน" })).not.toBeChecked();
  });
});
