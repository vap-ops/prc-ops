// Writing failing test first.
//
// Spec 141 U2 — the equipment management UI: a back-office screen to add/edit
// equipment items and bootstrap categories + owners. Mirrors the worker-roster
// manager (mocked server actions; interaction → action-shape assertions). No
// money here (acquisition_cost is admin-only, not in this UI).
//
// Spec 362 U1 — the page becomes READ-first (the /catalog pattern): search +
// counted category chips + grouped card rows, with EVERY write behind a
// BottomSheet. The write tests below therefore open their sheet first — the
// sheet unmounts its children when closed (bottom-sheet.tsx:69), so a field is
// not in the DOM until its trigger is tapped. That is the behaviour being
// pinned, not an incidental test detail.

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
  // Spec 202 U1 — SetDailyRate renders inside the row; mock its action too.
  setEquipmentDailyRate: vi.fn().mockResolvedValue({ ok: true }),
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
  dailyRates?: Record<string, number | null>;
}) {
  render(
    <EquipmentManager
      items={over?.items ?? []}
      categories={CATEGORIES}
      owners={OWNERS}
      projects={PROJECTS}
      movements={over?.movements ?? []}
      canManageRegistry={over?.canManageRegistry ?? true}
      {...(over?.dailyRates ? { dailyRates: over.dailyRates } : {})}
    />,
  );
}

/** Spec 362 U1 — every write lives behind a trigger; open its sheet first. */
function openSheet(triggerName: string) {
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
}

describe("EquipmentManager", () => {
  it("shows an equipment item on the row", () => {
    renderManager({ items: ITEMS });
    expect(screen.getByText("เครื่องปั่นไฟ 5kVA")).toBeInTheDocument();
  });

  it("adds a serialized (unit) item with its asset tag", async () => {
    renderManager();
    openSheet("เพิ่มอุปกรณ์");
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "สว่านไฟฟ้า" } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("เจ้าของ"), { target: { value: "o1" } });
    fireEvent.change(screen.getByLabelText("รหัสครุภัณฑ์"), { target: { value: "DR-1" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
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
    openSheet("เพิ่มอุปกรณ์");
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "นั่งร้านโครง" } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("เจ้าของ"), { target: { value: "o1" } });
    fireEvent.click(screen.getByRole("radio", { name: "จำนวนมาก (นับจำนวน)" }));
    expect(screen.queryByLabelText("รหัสครุภัณฑ์")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tracking: "bulk", quantity: 200, assetTag: "" }),
      ),
    );
  });

  it("rejects an invalid item client-side before calling the action", async () => {
    renderManager();
    openSheet("เพิ่มอุปกรณ์");
    // Bulk with no quantity → validateEquipmentItem fails; action never called.
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("เจ้าของ"), { target: { value: "o1" } });
    fireEvent.click(screen.getByRole("radio", { name: "จำนวนมาก (นับจำนวน)" }));
    // quantity left blank
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await waitFor(() => expect(screen.getByText(/จำนวนต้องเป็นจำนวนเต็ม/)).toBeInTheDocument());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("edits an item's name", async () => {
    renderManager({ items: ITEMS });
    // Spec 362 U1 — the add form is behind its own sheet now, so the edit sheet
    // holds the ONLY ชื่ออุปกรณ์ field in the document.
    openSheet("แก้ไข");
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), {
      target: { value: "เครื่องปั่นไฟ 5kVA (ปรับปรุง)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "e1", name: "เครื่องปั่นไฟ 5kVA (ปรับปรุง)" }),
      ),
    );
  });

  it("quick-adds a category", async () => {
    renderManager();
    openSheet("หมวดหมู่");
    fireEvent.change(screen.getByLabelText("ชื่อหมวดหมู่ใหม่"), { target: { value: "รถขุด" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มหมวดหมู่" }));
    await waitFor(() =>
      expect(mockAddCategory).toHaveBeenCalledWith(expect.objectContaining({ name: "รถขุด" })),
    );
  });

  it("quick-adds an owner", async () => {
    renderManager();
    openSheet("เจ้าของ");
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

  // Spec 202 U1 — per-item daily-rate control (money audience only)
  it("shows the daily-rate control for the money audience when dailyRates is given", () => {
    renderManager({ items: ITEMS, dailyRates: { e1: null } });
    expect(screen.getByText("ตั้งค่าเช่า/วัน")).toBeInTheDocument();
  });

  it("shows the current daily rate when set", () => {
    renderManager({ items: ITEMS, dailyRates: { e1: 1500 } });
    expect(screen.getByText(/฿1,?500/)).toBeInTheDocument();
  });

  it("never renders a daily-rate control on the site_admin field view", () => {
    // The page omits dailyRates for site_admin; even if a rate map leaked in,
    // canManageRegistry=false must suppress the money control.
    renderManager({ items: ITEMS, canManageRegistry: false, dailyRates: { e1: 1500 } });
    expect(screen.queryByText("ตั้งค่าเช่า/วัน")).not.toBeInTheDocument();
    expect(screen.queryByText(/฿1,?500/)).not.toBeInTheDocument();
  });

  // U5 — site_admin field view: list + move, no registry management
  it("hides registry management when canManageRegistry is false", () => {
    renderManager({ items: ITEMS, canManageRegistry: false });
    expect(screen.queryByRole("button", { name: "เพิ่มอุปกรณ์" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "หมวดหมู่" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เจ้าของ" })).not.toBeInTheDocument();
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

  // ---------------------------------------------------------------- spec 362 U1
  // The /catalog read-first pattern: the page opens on the DATA, every write is
  // one tap away in a sheet, and the list is searchable + filterable + grouped.

  const TWO_CATEGORIES = [
    { id: "c1", name: "เครื่องปั่นไฟ" },
    { id: "c2", name: "นั่งร้าน" },
  ];
  const MIXED: ManagedEquipmentItem[] = [
    ...ITEMS,
    { ...BULK_ITEMS[0]!, category_id: "c2" },
    {
      id: "e3",
      name: "นั่งร้านฐาน",
      category_id: "c2",
      owner_id: "o1",
      tracking: "unit",
      asset_tag: "SC-77",
      quantity: null,
      status: "available",
    },
  ];

  function renderMixed(over?: { canManageRegistry?: boolean }) {
    render(
      <EquipmentManager
        items={MIXED}
        categories={TWO_CATEGORIES}
        owners={OWNERS}
        projects={PROJECTS}
        movements={[]}
        canManageRegistry={over?.canManageRegistry ?? true}
      />,
    );
  }

  it("opens on the data — no write form is mounted until its trigger is tapped", () => {
    renderManager({ items: ITEMS });
    // The three curator forms that used to sit above the list.
    expect(screen.queryByLabelText("ชื่ออุปกรณ์")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อหมวดหมู่ใหม่")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อเจ้าของใหม่")).not.toBeInTheDocument();
    // …and the item is visible without scrolling past any of them.
    expect(screen.getByText("เครื่องปั่นไฟ 5kVA")).toBeInTheDocument();
  });

  it("groups rows under a counted category heading", () => {
    renderMixed();
    expect(screen.getByRole("heading", { name: "เครื่องปั่นไฟ (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "นั่งร้าน (2)" })).toBeInTheDocument();
  });

  it("offers counted category chips and narrows the list to the chosen one", () => {
    renderMixed();
    expect(screen.getByRole("radio", { name: "ทั้งหมด (3)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "นั่งร้าน (2)" }));
    expect(screen.getByText("นั่งร้านฐาน")).toBeInTheDocument();
    expect(screen.queryByText("เครื่องปั่นไฟ 5kVA")).not.toBeInTheDocument();
  });

  it("searches by name", () => {
    renderMixed();
    fireEvent.change(screen.getByLabelText("ค้นหาอุปกรณ์"), { target: { value: "นั่งร้านฐาน" } });
    expect(screen.getByText("นั่งร้านฐาน")).toBeInTheDocument();
    expect(screen.queryByText("เครื่องปั่นไฟ 5kVA")).not.toBeInTheDocument();
  });

  it("searches by asset tag", () => {
    renderMixed();
    fireEvent.change(screen.getByLabelText("ค้นหาอุปกรณ์"), { target: { value: "SC-77" } });
    expect(screen.getByText("นั่งร้านฐาน")).toBeInTheDocument();
    expect(screen.queryByText("เครื่องปั่นไฟ 5kVA")).not.toBeInTheDocument();
  });

  it("says so when a search matches nothing", () => {
    renderMixed();
    fireEvent.change(screen.getByLabelText("ค้นหาอุปกรณ์"), { target: { value: "zzzz" } });
    expect(screen.getByText("ไม่พบอุปกรณ์ที่ค้นหา")).toBeInTheDocument();
  });

  it("keeps both role-branched empty states", () => {
    const { unmount } = render(
      <EquipmentManager
        items={[]}
        categories={CATEGORIES}
        owners={OWNERS}
        projects={PROJECTS}
        movements={[]}
        canManageRegistry
      />,
    );
    expect(screen.getByText(/เพิ่มหมวดหมู่และเจ้าของก่อน/)).toBeInTheDocument();
    // The curator can still reach the add door with an empty registry.
    expect(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" })).toBeInTheDocument();
    unmount();

    renderManager({ items: [], canManageRegistry: false });
    expect(screen.getByText("ยังไม่มีอุปกรณ์ในระบบ")).toBeInTheDocument();
  });

  it("the field view keeps search and chips but gets no write doors", () => {
    renderMixed({ canManageRegistry: false });
    expect(screen.getByLabelText("ค้นหาอุปกรณ์")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "ทั้งหมด (3)" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ย้าย" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "แก้ไข" })).not.toBeInTheDocument();
  });

  it("edit and move each open a sheet, and only one at a time", () => {
    renderManager({ items: ITEMS });
    openSheet("แก้ไข");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("ชื่ออุปกรณ์")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    openSheet("ย้าย");
    expect(screen.getByLabelText("ประเภทการเคลื่อนย้าย")).toBeInTheDocument();
    // The edit body must not ride along inside the move sheet.
    expect(screen.queryByLabelText("ชื่ออุปกรณ์")).not.toBeInTheDocument();
  });

  it("the category sheet lists existing categories with their item counts", () => {
    renderMixed();
    openSheet("หมวดหมู่");
    expect(screen.getByRole("button", { name: "เปลี่ยนชื่อ นั่งร้าน" })).toBeInTheDocument();
    expect(screen.getByText("2 รายการ")).toBeInTheDocument();
  });
});
