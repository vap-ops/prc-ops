// Writing failing test first.
//
// Spec 141 U2 — the equipment management UI: a back-office screen to add/edit
// equipment items and bootstrap categories + owners. Mirrors the worker-roster
// manager (mocked server actions; interaction → action-shape assertions). No
// money here (acquisition_cost is admin-only, not in this UI).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpdate, mockAddCategory, mockAddOwner, mockMove, mockRefresh } = vi.hoisted(
  () => ({
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockAddCategory: vi.fn(),
    mockAddOwner: vi.fn(),
    mockMove: vi.fn(),
    mockRefresh: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/equipment/actions", () => ({
  createEquipment: mockCreate,
  updateEquipment: mockUpdate,
  createEquipmentCategory: mockAddCategory,
  createEquipmentOwner: mockAddOwner,
  recordEquipmentMovement: mockMove,
}));

import {
  EquipmentManager,
  type ManagedEquipmentItem,
  type EquipmentMovementRow,
} from "@/components/features/equipment/equipment-manager";

const CATEGORIES = [{ id: "c1", name: "เครื่องปั่นไฟ" }];
const OWNERS = [{ id: "o1", name: "บริษัทพี่น้อง" }];
const PROJECTS = [{ id: "p1", name: "ไซต์บางนา" }];
const ITEMS: ManagedEquipmentItem[] = [
  {
    id: "e1",
    name: "เครื่องปั่นไฟ 5kVA",
    category_id: "c1",
    owner_id: "o1",
    tracking: "unit",
    asset_tag: "GEN-001",
    quantity: null,
    status: "available",
  },
];
const BULK_ITEMS: ManagedEquipmentItem[] = [
  {
    id: "e2",
    name: "นั่งร้านโครง",
    category_id: "c1",
    owner_id: "o1",
    tracking: "bulk",
    asset_tag: null,
    quantity: 200,
    status: "available",
  },
];

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockAddCategory.mockReset().mockResolvedValue({ ok: true });
  mockAddOwner.mockReset().mockResolvedValue({ ok: true });
  mockMove.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderManager(over?: {
  items?: ManagedEquipmentItem[];
  movements?: EquipmentMovementRow[];
  canManageRegistry?: boolean;
}) {
  render(
    <EquipmentManager
      items={over?.items ?? []}
      categories={CATEGORIES}
      owners={OWNERS}
      projects={PROJECTS}
      movements={over?.movements ?? []}
      canManageRegistry={over?.canManageRegistry ?? true}
    />,
  );
}

describe("EquipmentManager", () => {
  it("shows an equipment item on the row", () => {
    renderManager({ items: ITEMS });
    expect(screen.getByText("เครื่องปั่นไฟ 5kVA")).toBeInTheDocument();
  });

  it("adds a serialized (unit) item with its asset tag", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "สว่านไฟฟ้า" } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("เจ้าของ"), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText("รหัสครุภัณฑ์"), { target: { value: "DR-1" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "สว่านไฟฟ้า",
          categoryId: "c1",
          ownerId: "o1",
          tracking: "unit",
          assetTag: "DR-1",
          quantity: null,
          status: "available",
        }),
      ),
    );
  });

  it("switches to bulk, hides the asset tag, and passes a quantity", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "นั่งร้านโครง" } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("เจ้าของ"), { target: { value: "o1" } });
    fireEvent.click(screen.getByRole("radio", { name: "จำนวนมาก (นับจำนวน)" }));
    expect(screen.queryByLabelText("รหัสครุภัณฑ์")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tracking: "bulk", quantity: 200, assetTag: "" }),
      ),
    );
  });

  it("rejects an invalid item client-side before calling the action", async () => {
    renderManager();
    // Bulk with no quantity → validateEquipmentItem fails; action never called.
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("เจ้าของ"), { target: { value: "o1" } });
    fireEvent.click(screen.getByRole("radio", { name: "จำนวนมาก (นับจำนวน)" }));
    // quantity left blank
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    await waitFor(() => expect(screen.getByText(/จำนวนต้องเป็นจำนวนเต็ม/)).toBeInTheDocument());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("edits an item's name", async () => {
    renderManager({ items: ITEMS });
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    // [0] = add form name, [1] = the editing row's name.
    const nameFields = screen.getAllByLabelText("ชื่ออุปกรณ์");
    fireEvent.change(nameFields[1]!, { target: { value: "เครื่องปั่นไฟ 5kVA (ปรับปรุง)" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "e1", name: "เครื่องปั่นไฟ 5kVA (ปรับปรุง)" }),
      ),
    );
  });

  it("quick-adds a category", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText("ชื่อหมวดหมู่ใหม่"), { target: { value: "รถขุด" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มหมวดหมู่" }));
    await waitFor(() =>
      expect(mockAddCategory).toHaveBeenCalledWith(expect.objectContaining({ name: "รถขุด" })),
    );
  });

  it("quick-adds an owner", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText("ชื่อเจ้าของใหม่"), { target: { value: "พี่น้อง 2" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มเจ้าของ" }));
    await waitFor(() =>
      expect(mockAddOwner).toHaveBeenCalledWith(expect.objectContaining({ name: "พี่น้อง 2" })),
    );
  });

  // U4 — move + where-is-it
  it("shows the current location badge from the latest movement", () => {
    renderManager({
      items: ITEMS,
      movements: [
        { itemId: "e1", kind: "deployed", projectId: "p1", occurredAt: "2026-07-05T00:00:00Z" },
      ],
    });
    expect(screen.getByText("หน้างาน: ไซต์บางนา")).toBeInTheDocument();
  });

  it("records a deploy-to-project movement", async () => {
    renderManager({ items: ITEMS });
    fireEvent.click(screen.getByRole("button", { name: "ย้าย" }));
    // deployed is the default kind → the project select is shown.
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการย้าย" }));
    await waitFor(() =>
      expect(mockMove).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "e1",
          kind: "deployed",
          projectId: "p1",
          quantity: 1,
        }),
      ),
    );
  });

  it("a non-deployed kind hides the project select and sends no project", async () => {
    renderManager({ items: ITEMS });
    fireEvent.click(screen.getByRole("button", { name: "ย้าย" }));
    fireEvent.change(screen.getByLabelText("ประเภทการเคลื่อนย้าย"), {
      target: { value: "returned" },
    });
    expect(screen.queryByLabelText("โครงการ")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการย้าย" }));
    await waitFor(() =>
      expect(mockMove).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "e1", kind: "returned", projectId: null }),
      ),
    );
  });

  it("a bulk item's move form shows a quantity field and passes it", async () => {
    renderManager({ items: BULK_ITEMS });
    fireEvent.click(screen.getByRole("button", { name: "ย้าย" }));
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("จำนวนที่ย้าย"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการย้าย" }));
    await waitFor(() =>
      expect(mockMove).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "e2", quantity: 50 }),
      ),
    );
  });

  // U5 — site_admin field view: list + move, no registry management
  it("hides registry management when canManageRegistry is false", () => {
    renderManager({ items: ITEMS, canManageRegistry: false });
    expect(screen.queryByRole("button", { name: "เพิ่มอุปกรณ์" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เพิ่มหมวดหมู่" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เพิ่มเจ้าของ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "แก้ไข" })).not.toBeInTheDocument();
  });

  it("still allows recording a move in the field (read-only registry) view", async () => {
    renderManager({
      items: ITEMS,
      canManageRegistry: false,
      movements: [
        { itemId: "e1", kind: "deployed", projectId: "p1", occurredAt: "2026-07-05T00:00:00Z" },
      ],
    });
    expect(screen.getByText("หน้างาน: ไซต์บางนา")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ย้าย" }));
    fireEvent.change(screen.getByLabelText("ประเภทการเคลื่อนย้าย"), {
      target: { value: "returned" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการย้าย" }));
    await waitFor(() =>
      expect(mockMove).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "e1", kind: "returned", projectId: null }),
      ),
    );
  });
});
