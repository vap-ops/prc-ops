// Spec 182 U1/U2 — the price-comparison table on an approved PR. Back-office
// records supplier quotes; the table ranks them cheapest-first, shows total
// (unit × qty) + % over the cheapest, adds/removes quotes, and a picked quote
// (default cheapest) prefills the create-PO sheet (supplier + net total).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockRemove, mockRefresh } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockRemove: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/requests/actions", () => ({
  addPurchaseQuote: mockAdd,
  removePurchaseQuote: mockRemove,
}));
// Stub the per-row quote-doc uploader (spec 182 U4) — it pulls in the browser
// Supabase client; the test only asserts PriceComparison wires it per row.
vi.mock("@/components/features/purchasing/quote-doc-attach", () => ({
  QuoteDocAttach: (props: { quoteId: string }) => (
    <div data-testid="quote-doc-attach" data-quote={props.quoteId} />
  ),
}));
// Stub the PO sheet — assert PriceComparison passes the picked quote's defaults.
vi.mock("@/components/features/purchasing/create-purchase-order-sheet", () => ({
  CreatePurchaseOrderSheet: (props: {
    open: boolean;
    defaultSupplierId?: string;
    defaultAmounts?: Record<string, string>;
  }) =>
    props.open ? (
      <div
        data-testid="po-sheet"
        data-supplier={props.defaultSupplierId ?? ""}
        data-amounts={JSON.stringify(props.defaultAmounts ?? null)}
      />
    ) : null,
}));

import {
  PriceComparison,
  type ItemPriceHistory,
} from "@/components/features/purchasing/price-comparison";

const quotes = [
  { id: "q2", supplierId: "s2", supplierName: "ไทยวัสดุ", unitPrice: 98, note: null },
  { id: "q1", supplierId: "s1", supplierName: "ส.รุ่งเรือง", unitPrice: 92, note: "ส่งฟรี" },
];
const suppliers = [
  { id: "s1", name: "ส.รุ่งเรือง", phone: null },
  { id: "s2", name: "ไทยวัสดุ", phone: null },
  { id: "s3", name: "โฮมโปร", phone: null },
];
const line = {
  id: "pr1",
  pr_number: 1,
  item_description: "เหล็กข้ออ้อย 12 มิล",
  quantity: 50,
  unit: "ท่อน",
  wp_code: null,
};

function renderPC(opts?: {
  quotes?: typeof quotes;
  history?: ItemPriceHistory[];
  quoteDocs?: Record<string, string>;
}) {
  render(
    <PriceComparison
      purchaseRequestId="pr1"
      projectId="proj1"
      quantity={50}
      unit="ท่อน"
      quotes={opts?.quotes ?? quotes}
      suppliers={suppliers}
      line={line}
      history={opts?.history ?? []}
      quoteDocs={opts?.quoteDocs ?? {}}
    />,
  );
}

beforeEach(() => {
  mockAdd.mockReset().mockResolvedValue({ ok: true, id: "qx" });
  mockRemove.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("PriceComparison (spec 182 U1)", () => {
  it("ranks cheapest-first with totals, ถูกสุด, and +% over cheapest", () => {
    renderPC();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByText("ส.รุ่งเรือง")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/ถูกสุด/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/4,600/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText("ไทยวัสดุ")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/4,900/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/\+7%/)).toBeInTheDocument();
  });

  it("offers only not-yet-quoted suppliers and adds a quote", async () => {
    renderPC();
    const picker = screen.getByLabelText("ผู้ขาย") as HTMLSelectElement;
    expect(within(picker).queryByRole("option", { name: "ส.รุ่งเรือง" })).toBeNull();
    expect(within(picker).getByRole("option", { name: "โฮมโปร" })).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "s3" } });
    fireEvent.change(screen.getByLabelText("ราคาต่อหน่วย"), { target: { value: "105" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่ม" }));

    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith({
        purchaseRequestId: "pr1",
        supplierId: "s3",
        unitPrice: 105,
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("removes a quote", async () => {
    renderPC();
    const rows = screen.getAllByRole("listitem");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "ลบ" }));
    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith({ purchaseRequestId: "pr1", quoteId: "q1" }),
    );
  });

  it("shows an empty state with no quotes", () => {
    renderPC({ quotes: [] });
    expect(screen.getByText(/ยังไม่มีใบเสนอราคา/)).toBeInTheDocument();
  });
});

describe("PriceComparison last-paid benchmark (spec 182 U3)", () => {
  const history: ItemPriceHistory[] = [
    {
      supplierName: "ส.รุ่งเรือง",
      netUnitPrice: 88,
      quantity: 40,
      purchasedAt: "2026-06-10T00:00:00Z",
    },
    {
      supplierName: "ไทยวัสดุ",
      netUnitPrice: 95,
      quantity: 30,
      purchasedAt: "2026-05-01T00:00:00Z",
    },
    { supplierName: "โฮมโปร", netUnitPrice: 91, quantity: 20, purchasedAt: "2026-04-01T00:00:00Z" },
  ];

  it("shows the newest purchase price, its supplier, and the times-bought count", () => {
    renderPC({ history });
    const line = screen.getByText(/เคยซื้อล่าสุด/);
    expect(line).toHaveTextContent("฿88/ท่อน");
    expect(line).toHaveTextContent("ส.รุ่งเรือง");
    expect(line).toHaveTextContent("3 ครั้ง");
  });

  it("renders no benchmark line when there is no history", () => {
    renderPC({ history: [] });
    expect(screen.queryByText(/เคยซื้อล่าสุด/)).toBeNull();
  });
});

describe("PriceComparison quote docs (spec 182 U4)", () => {
  it("links the attached doc and disables remove for a quote that has one", () => {
    // q1 (ส.รุ่งเรือง, cheapest) carries a doc; q2 (ไทยวัสดุ) does not.
    renderPC({ quoteDocs: { q1: "https://signed/q1.pdf" } });
    const rows = screen.getAllByRole("listitem");

    const docLink = within(rows[0]!).getByRole("link", { name: /ดูเอกสาร/ });
    expect(docLink).toHaveAttribute("href", "https://signed/q1.pdf");
    // A doc'd quote is kept for audit → its remove is disabled (append-only doc).
    expect(within(rows[0]!).getByRole("button", { name: "ลบ" })).toBeDisabled();
    // No attach affordance on a row that already has a doc.
    expect(within(rows[0]!).queryByTestId("quote-doc-attach")).toBeNull();
  });

  it("offers the attach affordance on a quote with no doc", () => {
    renderPC({ quoteDocs: { q1: "https://signed/q1.pdf" } });
    const rows = screen.getAllByRole("listitem");
    const attach = within(rows[1]!).getByTestId("quote-doc-attach");
    expect(attach).toHaveAttribute("data-quote", "q2");
    expect(within(rows[1]!).queryByRole("link", { name: /ดูเอกสาร/ })).toBeNull();
  });
});

describe("PriceComparison pick → PO (spec 182 U2)", () => {
  it("defaults the pick to the cheapest and prefills the PO sheet", () => {
    renderPC();
    fireEvent.click(screen.getByRole("button", { name: /สร้างใบสั่งซื้อ/ }));
    const sheet = screen.getByTestId("po-sheet");
    expect(sheet).toHaveAttribute("data-supplier", "s1"); // cheapest = ส.รุ่งเรือง
    expect(sheet).toHaveAttribute("data-amounts", JSON.stringify({ pr1: "4600" }));
  });

  it("re-picks a dearer quote and prefills that supplier + total", () => {
    renderPC();
    fireEvent.click(screen.getByLabelText("เลือก ไทยวัสดุ"));
    fireEvent.click(screen.getByRole("button", { name: /สร้างใบสั่งซื้อ/ }));
    const sheet = screen.getByTestId("po-sheet");
    expect(sheet).toHaveAttribute("data-supplier", "s2");
    expect(sheet).toHaveAttribute("data-amounts", JSON.stringify({ pr1: "4900" }));
  });
});
