// Spec 385 U3a — the ทะเบียนเครื่องมือ surface. The operator's report was that
// ทะเบียนอุปกรณ์ and หมวดอุปกรณ์ were "mixed up to อุปกรณ์ item": both hub doors
// dumped into the per-unit page while the actual catalog (39 SKUs) had no
// surface at all. This page IS that surface — SKU rows grouped by the function
// categories, curation (rename / recategorise / deactivate / add), and the
// category quick-add moved here (a category is a property of the TYPE now).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpdate, mockSetActive, mockAddCategory, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockSetActive: vi.fn(),
  mockAddCategory: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/equipment/actions", () => ({
  createEquipmentCatalogItem: mockCreate,
  updateEquipmentCatalogItem: mockUpdate,
  setEquipmentCatalogItemActive: mockSetActive,
  createEquipmentCategory: mockAddCategory,
  renameEquipmentCategory: vi.fn().mockResolvedValue({ ok: true }),
  // Spec 385 U3b — the rate control lives inside SkuRow.
  setEquipmentCatalogDefaultRate: vi.fn().mockResolvedValue({ ok: true }),
}));

import { EquipmentCatalogManager } from "@/components/features/equipment/equipment-catalog-manager";

const CATEGORIES = [
  { id: "c1", name: "เครื่องจักรก่อสร้าง" },
  { id: "c2", name: "เครื่องมือตัดและเจียร" },
];
const SKUS = [
  {
    id: "s1",
    name: "เครื่องตบดิน",
    categoryId: "c1",
    brand: "MARTON",
    model: null,
    defaultTracking: "unit" as const,
    isActive: true,
  },
  {
    id: "s2",
    name: "เลื่อยไฟฟ้า",
    categoryId: "c2",
    brand: null,
    model: null,
    defaultTracking: "unit" as const,
    isActive: true,
  },
  {
    id: "s3",
    name: "ของเก่าเลิกใช้",
    categoryId: "c2",
    brand: null,
    model: null,
    defaultTracking: "unit" as const,
    isActive: false,
  },
];

function renderCatalog(over?: { defaultRates?: Record<string, number | null> }) {
  render(
    <EquipmentCatalogManager
      skus={SKUS}
      categories={CATEGORIES}
      instanceCounts={{ s1: 2 }}
      {...(over?.defaultRates ? { defaultRates: over.defaultRates } : {})}
    />,
  );
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetActive.mockReset().mockResolvedValue({ ok: true });
  mockAddCategory.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("EquipmentCatalogManager", () => {
  it("groups active SKUs under the function-category headings", () => {
    renderCatalog();
    expect(screen.getByRole("heading", { name: /เครื่องจักรก่อสร้าง/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /เครื่องมือตัดและเจียร/ })).toBeInTheDocument();
    expect(screen.getByText("เครื่องตบดิน")).toBeInTheDocument();
  });

  it("shows how many real units instantiate a SKU — and that a SKU is ONE row", () => {
    renderCatalog();
    const row = screen.getByText("เครื่องตบดิน").closest("li")!;
    expect(within(row).getByText(/2 เครื่อง/)).toBeInTheDocument();
    const bare = screen.getByText("เลื่อยไฟฟ้า").closest("li")!;
    expect(within(bare).getByText(/ยังไม่มีเครื่อง/)).toBeInTheDocument();
  });

  it("renames a SKU through the edit sheet", async () => {
    renderCatalog();
    const row = screen.getByText("เครื่องตบดิน").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "แก้ไข" }));
    fireEvent.change(screen.getByLabelText("ชื่อรายการ"), {
      target: { value: "เครื่องตบดิน MARTON" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "s1", name: "เครื่องตบดิน MARTON" }),
      ),
    );
  });

  it("deactivates from the row and the SKU moves out of the picker's world", async () => {
    renderCatalog();
    const row = screen.getByText("เลื่อยไฟฟ้า").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "ปิดใช้งาน" }));
    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith({ id: "s2", active: false }));
  });

  it("parks inactive SKUs in a trailing section with a reactivate door", async () => {
    renderCatalog();
    expect(screen.getByText(/ปิดใช้งานแล้ว/)).toBeInTheDocument();
    const row = screen.getByText("ของเก่าเลิกใช้").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "เปิดใช้อีกครั้ง" }));
    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith({ id: "s3", active: true }));
  });

  it("registers a new SKU from the add sheet", async () => {
    renderCatalog();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการทะเบียน" }));
    fireEvent.change(screen.getByLabelText("ชื่อรายการ"), { target: { value: "เครื่องปั่นไฟ" } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกเข้าทะเบียน" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "เครื่องปั่นไฟ", categoryId: "c1", tracking: "unit" }),
      ),
    );
  });

  it("hosts the category quick-add — หมวดเครื่องมือ is curated HERE, not on the item page", async () => {
    renderCatalog();
    fireEvent.click(screen.getByRole("button", { name: "หมวดเครื่องมือ" }));
    fireEvent.change(screen.getByLabelText("ชื่อหมวดหมู่ใหม่"), { target: { value: "งานไฟฟ้า" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มหมวดหมู่" }));
    await waitFor(() =>
      expect(mockAddCategory).toHaveBeenCalledWith(expect.objectContaining({ name: "งานไฟฟ้า" })),
    );
  });

  it("the หมวดเครื่องมือ deep link opens the category sheet on mount", () => {
    render(
      <EquipmentCatalogManager
        skus={SKUS}
        categories={CATEGORIES}
        instanceCounts={{}}
        initialCategoriesOpen
      />,
    );
    // The sheet is already open — its add field is in the document without a tap.
    expect(screen.getByLabelText("ชื่อหมวดหมู่ใหม่")).toBeInTheDocument();
  });

  // Spec 385 U3b — money renders ONLY through the admin-read map: absent map =
  // zero money in the tree (the /equipment dailyRate idiom, kept at the SKU
  // grain). This pair is the non-vacuous version of the old "no money" case.
  it("renders no money when the page passed no rate map", () => {
    renderCatalog();
    expect(screen.queryByText(/฿/)).toBeNull();
    expect(screen.queryByText("ตั้งค่าเช่า/วัน")).toBeNull();
  });

  it("renders the default-rate control from the map — value or the set door", () => {
    renderCatalog({ defaultRates: { s1: 300, s2: null } });
    expect(screen.getByText(/฿300/)).toBeInTheDocument();
    // Exactly two set doors: s2 (null in the map) and s3 (absent → ?? null).
    // A looser >0 could not tell "read the map" from "ignored it".
    expect(screen.getAllByText("ตั้งค่าเช่า/วัน")).toHaveLength(2);
  });
});
