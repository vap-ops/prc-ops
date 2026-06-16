// Writing failing test first.
//
// Spec 90: ContactCrewSection — on a contractor/DC detail page, lists the DC
// workers under that contractor and lets PM add one. Adding reuses the
// createWorker action (worker_type='dc', the contractor as parent; a day rate
// is required — money stays managed on /workers).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({ createWorker: mockCreate }));

import { ContactCrewSection } from "@/components/features/contacts/contact-crew-section";

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("ContactCrewSection", () => {
  it("lists the existing crew", () => {
    render(
      <ContactCrewSection
        contractorId="c1"
        crew={[
          { id: "w1", name: "ช่างสมชาย" },
          { id: "w2", name: "ช่างสมศักดิ์" },
        ]}
      />,
    );
    expect(screen.getByText("ช่างสมชาย")).toBeInTheDocument();
    expect(screen.getByText("ช่างสมศักดิ์")).toBeInTheDocument();
  });

  it("adds a DC worker under this contractor via createWorker", async () => {
    render(<ContactCrewSection contractorId="c1" crew={[]} />);
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "คนใหม่" } });
    fireEvent.change(screen.getByLabelText("ค่าแรงต่อวัน (บาท)"), { target: { value: "450" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มทีมงาน" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "คนใหม่",
          workerType: "dc",
          contractorId: "c1",
          dayRate: 450,
        }),
      ),
    );
  });
});
