// Spec 368 U4 — the store section's split view: ยืมไปที่งาน (open obligations,
// WP + clock + who + คืน at the store) over อยู่ในคลัง (category groups, bulk
// ×qty). คืน reuses the SHARED return sheet (via="store").

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const checkInEquipment = vi.fn();
const fetchLoanPhotoUrls = vi.fn();
vi.mock("@/lib/equipment/usage-actions", () => ({
  checkInEquipment: (...a: unknown[]) => checkInEquipment(...a),
  fetchLoanPhotoUrls: (...a: unknown[]) => fetchLoanPhotoUrls(...a),
}));
vi.mock("@/lib/equipment/photo-upload", () => ({
  uploadConditionPhotos: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { StoreEquipmentSection } from "@/components/features/store/store-equipment-section";

const OUT = [
  {
    logId: "L1",
    itemId: "i2",
    itemName: "เครื่องตัดไฟเบอร์",
    wpId: "wp-9",
    wpCode: "W05-03",
    wpName: "งานผนัง",
    checkedOutOn: "2026-07-25",
    holderName: "สมชาย",
    days: 3,
  },
];

const IN_STORE = [
  {
    id: "i1",
    name: "สว่าน Hilti",
    categoryName: "เครื่องมือเจาะ",
    assetTag: "EQ-01",
    status: "on_site",
    condition: null,
    tracking: "unit" as const,
    quantity: null,
  },
  {
    id: "i3",
    name: "นั่งร้าน",
    categoryName: "นั่งร้าน",
    assetTag: null,
    status: "on_site",
    condition: null,
    tracking: "bulk" as const,
    quantity: 11,
  },
];

const BASE = {
  out: OUT,
  inStore: IN_STORE,
  counts: { inStore: 2, out: 1 },
  canReturn: true,
  revalidate: "/x",
  projectId: "p-1",
};

beforeEach(() => {
  checkInEquipment.mockReset().mockResolvedValue({ ok: true });
  fetchLoanPhotoUrls.mockReset().mockResolvedValue({ ok: true, urls: [] });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("spec 368 U4 — store equipment split", () => {
  it("header carries both counts; out rows show WP chip, clock, holder, คืน", () => {
    render(<StoreEquipmentSection {...BASE} />);
    expect(screen.getByText(/2 ในคลัง/)).toBeInTheDocument();
    expect(screen.getByText(/1 ยืมออก/)).toBeInTheDocument();
    expect(screen.getByText("เครื่องตัดไฟเบอร์")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /W05-03/ })).toHaveAttribute(
      "href",
      "/projects/p-1/work-packages/wp-9",
    );
    expect(screen.getByText(/ยืม 3 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/สมชาย/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คืน" })).toBeInTheDocument();
  });

  it("in-store keeps category groups and the bulk ×qty badge", () => {
    render(<StoreEquipmentSection {...BASE} />);
    expect(screen.getByText(/เครื่องมือเจาะ \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("×11")).toBeInTheDocument();
  });

  it("non-movers see the split but no คืน", () => {
    render(<StoreEquipmentSection {...BASE} canReturn={false} />);
    expect(screen.getByText("เครื่องตัดไฟเบอร์")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "คืน" })).not.toBeInTheDocument();
  });

  // Spec 370 U4b — the store PAGE now carries a hero scan door above the stock
  // console, and this section deliberately KEEPS its own contextual link: the
  // hero is above ~400 rows of stock, so deleting this one would leave the place
  // where the tools are actually listed with no way to borrow. That decision was
  // defended only in prose until this pin — the link was deletable with the
  // whole suite green.
  it("keeps its own scan link beside the tools", () => {
    render(<StoreEquipmentSection {...BASE} />);
    expect(screen.getByRole("link", { name: /สแกนยืม\/คืนอุปกรณ์/ })).toHaveAttribute(
      "href",
      "/equipment/scan?from=%2Fprojects%2Fp-1%2Fstore",
    );
  });

  it("hides its scan link from non-movers", () => {
    render(<StoreEquipmentSection {...BASE} canReturn={false} />);
    expect(screen.queryByRole("link", { name: /สแกนยืม\/คืนอุปกรณ์/ })).not.toBeInTheDocument();
  });

  it("zero out-loans → no ยืมไปที่งาน group at all (no empty box)", () => {
    render(<StoreEquipmentSection {...BASE} out={[]} counts={{ inStore: 2, out: 0 }} />);
    expect(screen.queryByText(/ยืมไปที่งาน/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 ในคลัง/)).toBeInTheDocument();
  });

  it("คืน opens the shared return sheet against the loan's ORIGINAL log id", async () => {
    const user = userEvent.setup();
    render(<StoreEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "คืน" }));
    expect(fetchLoanPhotoUrls).toHaveBeenCalledWith("L1");
    expect(screen.getByRole("button", { name: "บันทึกการคืน" })).toBeDisabled();
  });

  it("renders nothing when the whole set is empty (U1's no-empty-box rule)", () => {
    const { container } = render(
      <StoreEquipmentSection {...BASE} out={[]} inStore={[]} counts={{ inStore: 0, out: 0 }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
