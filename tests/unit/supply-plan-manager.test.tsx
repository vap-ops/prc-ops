// Spec 176 U2/U3 + spec 181 U2 — the supply-plan planning screen. A planner (or
// procurement) builds the plan in an INLINE GRID: fill rows (item + WP + qty +
// note) and save them in one bulk write; remove saved lines; submit; an approver
// (PD/super) approves/rejects. Mocked actions + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBulkAdd,
  mockRemove,
  mockSubmit,
  mockApprove,
  mockReject,
  mockGenerate,
  mockReopen,
  mockRefresh,
} = vi.hoisted(() => ({
  mockBulkAdd: vi.fn(),
  mockRemove: vi.fn(),
  mockSubmit: vi.fn(),
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
  mockGenerate: vi.fn(),
  mockReopen: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/supply-plan/actions", () => ({
  bulkAddPlanLines: mockBulkAdd,
  removePlanLine: mockRemove,
  submitPlan: mockSubmit,
  approvePlan: mockApprove,
  rejectPlan: mockReject,
  generatePlanPurchaseRequests: mockGenerate,
  reopenPlan: mockReopen,
}));

import {
  SupplyPlanManager,
  expandRowToWorkPackages,
  type PlanLine,
  type PlanStatus,
} from "@/components/features/supply-plan/supply-plan-manager";

const catalogItems = [
  {
    id: "ci1",
    // Spec 221 cleanup — managed category (id + name), not the item_category enum.
    categoryId: "cat-elec",
    categoryName: "งานไฟฟ้า",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    thumbnailUrl: null,
  },
];
const categories = [{ id: "cat-elec", name: "งานไฟฟ้า" }];
const workPackages = [
  { id: "wp1", code: "WP-01", name: "งานก่อสร้าง" },
  { id: "wp2", code: "WP-02", name: "งานติดตั้ง" },
];

// Spec 189: the วัสดุ field is the shared CatalogItemPicker (a BottomSheet),
// not a <select> — open it and click the item row.
function pickFirstMaterial() {
  fireEvent.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
  fireEvent.click(screen.getByRole("button", { name: /สายไฟ NYY/ }));
}
const oneLine: PlanLine = {
  id: "l1",
  baseItem: "สายไฟ NYY",
  specAttrs: "3x6",
  unit: "ม้วน",
  qty: 10,
  wpLabel: "WP-01",
  converted: false,
};

beforeEach(() => {
  mockBulkAdd.mockReset().mockResolvedValue({ ok: true, count: 1 });
  mockRemove.mockReset().mockResolvedValue({ ok: true });
  mockSubmit.mockReset().mockResolvedValue({ ok: true });
  mockApprove.mockReset().mockResolvedValue({ ok: true });
  mockReject.mockReset().mockResolvedValue({ ok: true });
  mockGenerate.mockReset().mockResolvedValue({ ok: true, count: 1 });
  mockReopen.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderManager(opts: {
  planStatus: PlanStatus | null;
  planId?: string | null;
  canApprove?: boolean;
  canOverride?: boolean;
  overriddenByName?: string | null;
  lines?: PlanLine[];
}) {
  render(
    <SupplyPlanManager
      projectId="p1"
      planId={opts.planId ?? "pl1"}
      planStatus={opts.planStatus}
      canApprove={opts.canApprove ?? false}
      canOverride={opts.canOverride ?? false}
      overriddenByName={opts.overriddenByName ?? null}
      lines={opts.lines ?? []}
      catalogItems={catalogItems}
      categories={categories}
      workPackages={workPackages}
    />,
  );
}

describe("SupplyPlanManager grid (spec 181 U2)", () => {
  it("disables save until a row has an item and a positive qty (WP optional)", () => {
    renderManager({ planStatus: "draft" });
    const save = screen.getByRole("button", { name: /บันทึก/ });
    expect(save).toBeDisabled();
    pickFirstMaterial();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    expect(save).toBeEnabled();
  });

  it("bulk-saves filled rows via bulkAddPlanLines", async () => {
    renderManager({ planStatus: "draft" });
    pickFirstMaterial();
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));

    await waitFor(() =>
      expect(mockBulkAdd).toHaveBeenCalledWith({
        projectId: "p1",
        planId: "pl1",
        lines: [{ catalogItemId: "ci1", workPackageId: "wp1", qty: 10, note: "" }],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("sends workPackageId null for a whole-project line (no WP chosen)", async () => {
    renderManager({ planStatus: "draft" });
    pickFirstMaterial();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    await waitFor(() =>
      expect(mockBulkAdd).toHaveBeenCalledWith({
        projectId: "p1",
        planId: "pl1",
        lines: [{ catalogItemId: "ci1", workPackageId: null, qty: 4, note: "" }],
      }),
    );
  });

  it("adds another row so multiple items can be entered at once", () => {
    renderManager({ planStatus: "draft" });
    // One material picker trigger per row.
    expect(screen.getAllByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มแถว/ }));
    expect(screen.getAllByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" })).toHaveLength(2);
  });

  it("removes a saved line", async () => {
    renderManager({ planStatus: "draft", lines: [oneLine] });
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ projectId: "p1", lineId: "l1" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("submits a draft plan for approval", async () => {
    renderManager({ planStatus: "draft", lines: [oneLine] });
    fireEvent.click(screen.getByRole("button", { name: "ส่งอนุมัติ" }));
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith({ projectId: "p1", planId: "pl1" }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("an approver can approve or reject a submitted plan", async () => {
    renderManager({ planStatus: "submitted", canApprove: true, lines: [oneLine] });
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith({ projectId: "p1", planId: "pl1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ตีกลับ" }));
    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith({ projectId: "p1", planId: "pl1" }),
    );
  });

  it("a submitted plan is read-only to a non-approver (no grid / remove / approve)", () => {
    renderManager({ planStatus: "submitted", canApprove: false, lines: [oneLine] });
    expect(screen.queryByRole("button", { name: /บันทึก/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /เพิ่มแถว/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "ลบ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "อนุมัติ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งอนุมัติ" })).toBeNull();
  });
});

const convertibleLine: PlanLine = {
  id: "lc",
  baseItem: "ปูน",
  specAttrs: null,
  unit: "ถุง",
  qty: 20,
  wpLabel: "WP-01",
  converted: false,
};
const convertedLine: PlanLine = {
  id: "ld",
  baseItem: "เหล็ก",
  specAttrs: null,
  unit: "เส้น",
  qty: 5,
  wpLabel: "WP-01",
  converted: true,
};
const wholeProjectLine: PlanLine = {
  id: "lw",
  baseItem: "สีรองพื้น",
  specAttrs: null,
  unit: "แกลลอน",
  qty: 3,
  wpLabel: null,
  converted: false,
};

describe("SupplyPlanManager convert mode (spec 181 U4)", () => {
  it("generates PRs for the checked lines of an approved plan", async () => {
    renderManager({
      planStatus: "approved",
      lines: [convertibleLine, convertedLine, wholeProjectLine],
    });
    // An already-converted line shows the badge (no checkbox). Spec 195 P2: a
    // whole-project line is now selectable too (it becomes a WP-less PR).
    expect(screen.getByText("สร้างคำขอซื้อแล้ว")).toBeInTheDocument();
    expect(screen.queryByLabelText("เลือก เหล็ก")).toBeNull();
    expect(screen.getByLabelText("เลือก สีรองพื้น")).toBeInTheDocument();

    const generate = screen.getByRole("button", { name: /สร้างคำขอซื้อ/ });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByLabelText("เลือก ปูน"));
    expect(generate).toBeEnabled();
    fireEvent.click(generate);

    await waitFor(() =>
      expect(mockGenerate).toHaveBeenCalledWith({
        projectId: "p1",
        planId: "pl1",
        lineIds: ["lc"],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("select-all checks every convertible line", () => {
    renderManager({ planStatus: "approved", lines: [convertibleLine, convertedLine] });
    fireEvent.click(screen.getByLabelText("เลือกทั้งหมด"));
    expect((screen.getByLabelText("เลือก ปูน") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /สร้างคำขอซื้อ \(1\)/ })).toBeEnabled();
  });

  it("shows no convert UI on a draft plan", () => {
    renderManager({ planStatus: "draft", lines: [convertibleLine] });
    expect(screen.queryByRole("button", { name: /สร้างคำขอซื้อ/ })).toBeNull();
    expect(screen.queryByLabelText("เลือก ปูน")).toBeNull();
  });

  // Spec 194: super_admin reopen + the override marker.
  it("super_admin gets a reopen button on an approved plan; it calls reopenPlan", async () => {
    renderManager({ planStatus: "approved", canOverride: true });
    fireEvent.click(screen.getByRole("button", { name: /เปิดแก้ไข/ }));
    await waitFor(() =>
      expect(mockReopen).toHaveBeenCalledWith({ projectId: "p1", planId: "pl1" }),
    );
  });

  it("hides the reopen button when the viewer cannot override", () => {
    renderManager({ planStatus: "approved", canOverride: false });
    expect(screen.queryByRole("button", { name: /เปิดแก้ไข/ })).toBeNull();
  });

  it("shows the overridden-by marker when the plan was reopened", () => {
    renderManager({ planStatus: "draft", canOverride: true, overriddenByName: "สมชาย" });
    expect(screen.getByText(/ปรับแก้โดย สมชาย/)).toBeInTheDocument();
  });
});

// Spec 222 — one item into multiple work packages (the "pre-fill rows" model).
// Spec 228 (ADR 0066 / S7) — the row's picker is scoped to its chosen WP's
// work-category via Relation R (resolved server-side into wpScopedCategories).
describe("SupplyPlanManager scoped picker wiring (spec 228)", () => {
  const twoItems = [
    {
      id: "ci-elec",
      categoryId: "cat-elec",
      categoryName: "งานไฟฟ้า",
      baseItem: "สายไฟ NYY",
      specAttrs: "3x6",
      unit: "ม้วน",
      thumbnailUrl: null,
    },
    {
      id: "ci-steel",
      categoryId: "cat-steel",
      categoryName: "เหล็กเสริม",
      baseItem: "เหล็กข้ออ้อย",
      specAttrs: "12 มิล",
      unit: "ท่อน",
      thumbnailUrl: null,
    },
  ];
  const twoCategories = [
    { id: "cat-elec", name: "งานไฟฟ้า" },
    { id: "cat-steel", name: "เหล็กเสริม" },
  ];

  function renderScoped() {
    render(
      <SupplyPlanManager
        projectId="p1"
        planId="pl1"
        planStatus="draft"
        canApprove={false}
        canOverride={false}
        overriddenByName={null}
        lines={[]}
        catalogItems={twoItems}
        categories={twoCategories}
        workPackages={workPackages}
        itemMemberships={[]}
        // WP-01 buys งานไฟฟ้า materials; WP-02 is unmapped (no scope).
        wpScopedCategories={{ wp1: ["cat-elec"] }}
      />,
    );
  }

  it("scopes the picker to the chosen WP's work-category, the rest still reachable", () => {
    renderScoped();
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp1" } });
    fireEvent.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
    // The in-scope (งานไฟฟ้า) item surfaces; the steel item is pre-filtered out.
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeNull();
    // Never hides — the แสดงทั้งหมด escape reveals the full catalog.
    fireEvent.click(screen.getByRole("button", { name: /แสดงทั้งหมด/ }));
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
  });

  it("shows the full catalog for a whole-project row (no WP → no scope)", () => {
    renderScoped();
    // งาน left as ทั้งโครงการ (workPackageId "") → unscoped show-all.
    fireEvent.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /แสดงทั้งหมด/ })).toBeNull();
  });

  it("shows the full catalog for a WP whose work-category is unmapped", () => {
    renderScoped();
    fireEvent.change(screen.getByLabelText("งาน"), { target: { value: "wp2" } });
    fireEvent.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
    expect(screen.getByRole("button", { name: /สายไฟ NYY/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
  });
});

describe("expandRowToWorkPackages (spec 222)", () => {
  const row = { key: 1, catalogItemId: "ci1", workPackageId: "", qty: "5", note: "n" };

  it("returns the row unchanged when no WPs are given", () => {
    expect(expandRowToWorkPackages(row, [])).toEqual([row]);
  });

  it("fans one item-row into one blank-qty row per WP", () => {
    const out = expandRowToWorkPackages(row, ["wp1", "wp2"]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.workPackageId)).toEqual(["wp1", "wp2"]);
    expect(out.every((r) => r.catalogItemId === "ci1")).toBe(true);
    expect(out.every((r) => r.qty === "" && r.note === "")).toBe(true);
    // Each spawned row is a distinct draft row (its own key).
    expect(new Set(out.map((r) => r.key)).size).toBe(2);
  });
});

describe("SupplyPlanManager multi-WP fan-out (spec 222)", () => {
  it("keeps the multi-WP button tappable and guides item-first via the confirm", () => {
    renderManager({ planStatus: "draft" });
    // The button is always tappable — no greyed dead state before an item exists.
    const open = screen.getByRole("button", { name: /หลายงาน/ });
    expect(open).toBeEnabled();
    fireEvent.click(open);
    // The panel opens and explains the order; confirm waits for an item even after
    // a WP is ticked.
    expect(screen.getByText(/เลือกวัสดุ.*ก่อน/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("เลือกงาน WP-01"));
    expect(screen.getByRole("button", { name: "ยืนยันเลือกหลายงาน" })).toBeDisabled();
    // Picking the item enables confirm.
    pickFirstMaterial();
    expect(screen.getByRole("button", { name: "ยืนยันเลือกหลายงาน" })).toBeEnabled();
  });

  it("fans a picked item into one row per chosen WP, then bulk-saves them", async () => {
    renderManager({ planStatus: "draft" });
    pickFirstMaterial();

    // Open the WP checklist, tick both WPs, confirm.
    fireEvent.click(screen.getByRole("button", { name: /หลายงาน/ }));
    fireEvent.click(screen.getByLabelText("เลือกงาน WP-01"));
    fireEvent.click(screen.getByLabelText("เลือกงาน WP-02"));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันเลือกหลายงาน" }));

    // The single row became two — one per WP — each with the same item, blank qty.
    const qtys = screen.getAllByLabelText("จำนวน") as HTMLInputElement[];
    expect(qtys).toHaveLength(2);
    expect(qtys.every((q) => q.value === "")).toBe(true);
    const wps = screen.getAllByLabelText("งาน") as HTMLSelectElement[];
    expect(wps.map((w) => w.value)).toEqual(["wp1", "wp2"]);

    // The planner fills each WP's quantity, then saves.
    fireEvent.change(qtys[0]!, { target: { value: "10" } });
    fireEvent.change(qtys[1]!, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));

    await waitFor(() =>
      expect(mockBulkAdd).toHaveBeenCalledWith({
        projectId: "p1",
        planId: "pl1",
        lines: [
          { catalogItemId: "ci1", workPackageId: "wp1", qty: 10, note: "" },
          { catalogItemId: "ci1", workPackageId: "wp2", qty: 5, note: "" },
        ],
      }),
    );
  });
});
