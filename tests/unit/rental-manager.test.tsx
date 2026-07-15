// Writing failing test first.
//
// Spec 268 / 323 U1c — RentalManager is now the read-only deals list (recording
// moved into AddRentalFab + a bottom sheet). Cards list recorded rentals; each
// card's ผูกโครงการ (allocate) and ยกเลิกการเช่า (void, spec 312) open in a bottom
// sheet, not an inline disclosure. Mocked actions + router.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAllocation, mockVoid, mockRefresh } = vi.hoisted(() => ({
  mockCreateAllocation: vi.fn(),
  mockVoid: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/equipment/rentals/actions", () => ({
  createRentalAllocation: mockCreateAllocation,
  voidRentalBatch: mockVoid,
}));

import { RentalManager } from "@/components/features/equipment/rental-manager";
import type { RentalCard } from "@/lib/equipment/rental-view";

const projects = [{ id: "p1", name: "โครงการ A" }];
const rentals: RentalCard[] = [
  {
    id: "b1",
    supplierName: "บ.เครนไทย",
    rateLabel: "฿90,000.00/เดือน",
    periodLabel: "เริ่ม 1 ก.ค. 2569 · ตลอดโครงการ (จนกว่าจะคืน)",
    note: null,
    voidable: false,
    allocations: [{ id: "a1", projectName: "โครงการ A", periodLabel: "ตลอดโครงการ" }],
  },
];

function renderManager(
  cards: RentalCard[] = rentals,
  lockedProject?: { id: string; name: string },
) {
  return render(
    <RentalManager
      projects={projects}
      rentals={cards}
      defaultDate="2026-07-05"
      {...(lockedProject ? { lockedProject } : {})}
    />,
  );
}

describe("RentalManager — read-only list", () => {
  beforeEach(() => {
    mockCreateAllocation.mockReset().mockResolvedValue({ ok: true });
    mockVoid.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
  });

  it("renders rental cards with rate, period, and allocation chips", () => {
    renderManager();
    const list = within(screen.getByRole("region", { name: "รายการเช่า" }));
    expect(list.getByText("บ.เครนไทย")).toBeInTheDocument();
    expect(list.getByText("฿90,000.00/เดือน")).toBeInTheDocument();
    expect(list.getByText(/โครงการ A ·/)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is recorded yet", () => {
    renderManager([]);
    expect(screen.getByText(/ยังไม่มีการเช่า/)).toBeInTheDocument();
  });

  it("does not render a record form (moved to the FAB sheet)", () => {
    renderManager();
    expect(screen.queryByLabelText("เช่าจาก")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกการเช่า" })).not.toBeInTheDocument();
  });

  it("allocates an existing rental to a project from a card sheet", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "ผูกโครงการ" }));
    fireEvent.change(screen.getByLabelText("โครงการที่ผูก"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("วันเริ่มผูก"), { target: { value: "2026-07-06" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันผูกโครงการ" }));
    await waitFor(() =>
      expect(mockCreateAllocation).toHaveBeenCalledWith({
        batchId: "b1",
        projectId: "p1",
        startsOn: "2026-07-06",
        endsOn: null,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    // sheet closed on success
    await waitFor(() => expect(screen.queryByLabelText("โครงการที่ผูก")).not.toBeInTheDocument());
  });

  it("hides the per-card ผูกโครงการ control when project-locked", () => {
    renderManager(rentals, { id: "p1", name: "โครงการ A" });
    expect(screen.queryByRole("button", { name: "ผูกโครงการ" })).not.toBeInTheDocument();
  });

  // Spec 312 — void a rental batch from its card.
  const voidableCard: RentalCard = {
    id: "vb",
    supplierName: "บ.เครนไทย",
    rateLabel: "฿11,000.00/วัน",
    periodLabel: "8 ก.ค. 2569 – 8 ก.ค. 2569",
    note: "รถแม็คโคร PC 140",
    voidable: true,
    allocations: [],
  };

  it("hides the void control for a non-voidable batch", () => {
    renderManager(); // the default card has voidable: false
    expect(screen.queryByRole("button", { name: "ยกเลิกการเช่า" })).not.toBeInTheDocument();
  });

  // Spec 312 follow-up 2 — the void trigger must read as a real (danger) button,
  // not an easy-to-miss bare text link. Pinned by the outline-danger border token.
  it("renders the void trigger as a prominent outlined danger button", () => {
    renderManager([voidableCard]);
    const trigger = screen.getByRole("button", { name: "ยกเลิกการเช่า" });
    expect(trigger).toHaveClass("border-danger-edge");
    expect(trigger.className).not.toContain("hover:underline");
  });

  it("voids a batch after a reason is entered in the sheet, then refreshes", async () => {
    renderManager([voidableCard]);
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการเช่า" }));
    // the confirm is disabled until a reason is typed
    expect(screen.getByRole("button", { name: "ยืนยันยกเลิก" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("เหตุผลการยกเลิก"), {
      target: { value: "ทดสอบระบบ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));
    await waitFor(() =>
      expect(mockVoid).toHaveBeenCalledWith({ batchId: "vb", reason: "ทดสอบระบบ" }),
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("surfaces a void error and does not refresh", async () => {
    mockVoid.mockResolvedValue({ ok: false, error: "ยกเลิกไม่ได้" });
    renderManager([voidableCard]);
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการเช่า" }));
    fireEvent.change(screen.getByLabelText("เหตุผลการยกเลิก"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ยกเลิกไม่ได้");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
