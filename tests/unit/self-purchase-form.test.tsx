// Spec 285 U1 — the self-purchase is now a catalog-only, amount-required expense.
// No free-text (พิมพ์เอง), no ใช้ที่งานนี้เลย (use-now); it always records via
// recordSitePurchase (the attachable path) and reveals the item + docs uploaders.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecord, mockUseNow, mockRefresh } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  mockUseNow: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("@/app/requests/actions", () => ({ recordSitePurchase: mockRecord }));
vi.mock("@/app/store/actions", () => ({ sitePurchaseUseNow: mockUseNow }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
// Spec 285 U2 — mock the uploaders as buttons that fire onUploaded on click, so
// the form's completeness gate can be driven from the test.
vi.mock("@/components/features/purchasing/item-photo-uploader", () => ({
  ItemPhotoUploader: ({ onUploaded }: { onUploaded?: () => void }) => (
    <button type="button" data-testid="item-photo-uploader" onClick={() => onUploaded?.()}>
      photo
    </button>
  ),
}));
vi.mock("@/components/features/purchasing/invoice-uploader", () => ({
  InvoiceUploader: ({ onUploaded }: { onUploaded?: () => void }) => (
    <button type="button" data-testid="invoice-uploader" onClick={() => onUploaded?.()}>
      doc
    </button>
  ),
}));

import { SelfPurchaseForm } from "@/components/features/purchasing/self-purchase-form";

const WP = "00000000-0000-0000-0000-000000000001";
const PROJECT = "00000000-0000-0000-0000-000000000002";
const catalogItems = [
  {
    id: "ci-1",
    // Spec 221 cleanup — managed category (id + name), not the item_category enum.
    categoryId: "cat-elec",
    categoryName: "งานไฟฟ้า",
    baseItem: "สายไฟ",
    specAttrs: "3x6",
    unit: "ม้วน",
    thumbnailUrl: null,
  },
];
const categories = [{ id: "cat-elec", name: "งานไฟฟ้า" }];

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue({ ok: true, id: "rec-1" });
  mockUseNow.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderForm() {
  render(
    <SelfPurchaseForm
      projectId={PROJECT}
      workPackageId={WP}
      catalogItems={catalogItems}
      categories={categories}
    />,
  );
}

async function pickItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
  await user.click(screen.getByRole("button", { name: /สายไฟ/ }));
}

describe("SelfPurchaseForm (spec 285 U1 — catalog-only expense)", () => {
  it("is catalog-only — no พิมพ์เอง (free-text) toggle", () => {
    renderForm();
    expect(screen.queryByText("พิมพ์เอง")).toBeNull();
    expect(screen.queryByLabelText("รายการที่ซื้อ")).toBeNull();
  });

  it("has no ใช้ที่งานนี้เลย (use-now) toggle", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickItem(user);
    expect(screen.queryByLabelText(/ใช้ที่งานนี้เลย/)).toBeNull();
  });

  it("records a catalog expense (amount required) and reveals the uploaders", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickItem(user);
    await user.type(screen.getByLabelText("จำนวน"), "5");
    await user.type(screen.getByLabelText("จำนวนเงิน (บาท)"), "107");
    await user.click(screen.getByLabelText("มีใบกำกับภาษี (แยกภาษีซื้อ)"));
    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องซื้อ"), "unplanned_miss");
    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));

    await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        workPackageId: WP,
        itemDescription: "สายไฟ 3x6",
        unit: "ม้วน",
        quantity: 5,
        amount: 107,
        vatRate: 7,
      }),
    );
    expect(mockUseNow).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("item-photo-uploader")).toBeInTheDocument());
    expect(screen.getByTestId("invoice-uploader")).toBeInTheDocument();
  });

  it("blocks recording when no amount is entered (amount required)", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickItem(user);
    await user.type(screen.getByLabelText("จำนวน"), "5");
    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องซื้อ"), "unplanned_miss");
    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));
    expect(mockRecord).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("stays 'ยังไม่สมบูรณ์' until BOTH an item photo and an accounting doc are attached (spec 285 U2)", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickItem(user);
    await user.type(screen.getByLabelText("จำนวน"), "5");
    await user.type(screen.getByLabelText("จำนวนเงิน (บาท)"), "107");
    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องซื้อ"), "unplanned_miss");
    await user.click(screen.getByRole("button", { name: "บันทึกการซื้อ" }));

    // recorded, no evidence yet → incomplete, not done
    await waitFor(() =>
      expect(screen.getByText("ยังไม่สมบูรณ์ (รอรูปสินค้า + เอกสาร)")).toBeInTheDocument(),
    );
    expect(screen.queryByText("บันทึกค่าใช้จ่ายครบถ้วนแล้ว")).toBeNull();

    // item photo only → still incomplete
    await user.click(screen.getByTestId("item-photo-uploader"));
    expect(screen.getByText("ยังไม่สมบูรณ์ (รอรูปสินค้า + เอกสาร)")).toBeInTheDocument();
    expect(screen.queryByText("บันทึกค่าใช้จ่ายครบถ้วนแล้ว")).toBeNull();

    // + accounting doc → now complete
    await user.click(screen.getByTestId("invoice-uploader"));
    await waitFor(() =>
      expect(screen.getByText("บันทึกค่าใช้จ่ายครบถ้วนแล้ว")).toBeInTheDocument(),
    );
    expect(screen.queryByText("ยังไม่สมบูรณ์ (รอรูปสินค้า + เอกสาร)")).toBeNull();
  });

  it("labels a picked catalog item with its managed category name (spec 221)", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickItem(user);
    // The chosen chip shows "<managed category name> · <unit>", not an enum label.
    expect(screen.getByText(/งานไฟฟ้า · ม้วน/)).toBeInTheDocument();
  });
});
