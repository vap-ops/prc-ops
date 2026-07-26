// Writing failing test first.
//
// Spec 362 U3 — /workers (ทะเบียนช่างและค่าแรง) becomes a READ-first registry,
// the third and last sibling of the ทะเบียนวัสดุ pattern. Before: the app's
// largest form (12 fields) sat permanently expanded above the roster, which was
// grouped by pay_type into two fixed blocks with no search, no counts, no empty
// state, and a per-row edit that expanded inline and ran to hundreds of pixels.
//
// This file covers the registry furniture only; the existing
// worker-roster-*.test.tsx files keep covering the form/edit BEHAVIOUR (re-aimed
// through the sheet, since BottomSheet unmounts its children when closed).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpdate, mockSetRate, mockAssign, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockSetRate: vi.fn(),
  mockAssign: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: mockCreate,
  updateWorker: mockUpdate,
  setWorkerDayRate: mockSetRate,
  assignWorkerToProject: mockAssign,
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import {
  WorkerRosterManager,
  type ManagedWorker,
} from "@/components/features/labor/worker-roster-manager";

function worker(over: Partial<ManagedWorker> & { id: string; name: string }): ManagedWorker {
  return {
    pay_type: "daily",
    contractor_id: null,
    day_rate: 500,
    active: true,
    note: null,
    employment_type: "permanent",
    portalBound: false,
    project_id: null,
    level: null,
    trades: [],
    phone: null,
    tax_id: null,
    bank_name: null,
    bank_account_number: null,
    bank_account_name: null,
    gender: null,
    ...over,
  };
}

const ROSTER: ManagedWorker[] = [
  worker({ id: "w1", name: "สมชาย ใจดี", pay_type: "monthly", phone: "0812345678" }),
  worker({ id: "w2", name: "สมหญิง ขยัน", pay_type: "daily" }),
  worker({
    id: "w3",
    name: "ประสิทธิ์ ช่างไฟ",
    pay_type: "daily",
    trades: [{ categoryId: "t1", code: "W03", nameTh: "งานไฟฟ้า", isPrimary: true }],
  }),
];

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetRate.mockReset().mockResolvedValue({ ok: true });
  mockAssign.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderRoster(workers = ROSTER) {
  render(<WorkerRosterManager workers={workers} contractors={[]} />);
}

describe("WorkerRosterManager — registry shape (spec 362 U3)", () => {
  it("opens on the roster — the add form is not mounted until its door is tapped", () => {
    renderRoster();
    expect(screen.queryByLabelText("ชื่อ")).not.toBeInTheDocument();
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มช่าง" }));
    expect(screen.getByLabelText("ชื่อ")).toBeInTheDocument();
  });

  it("groups the roster by การจ่าย under counted headings", () => {
    renderRoster();
    expect(screen.getByRole("heading", { name: "ช่างรายเดือน (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ช่างรายวัน (2)" })).toBeInTheDocument();
  });

  it("offers counted การจ่าย chips and narrows to the chosen one", () => {
    renderRoster();
    expect(screen.getByRole("radio", { name: "ทั้งหมด (3)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "ช่างรายเดือน (1)" }));
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.queryByText("สมหญิง ขยัน")).not.toBeInTheDocument();
  });

  it("searches by name, by phone and by trade", () => {
    renderRoster();
    const box = () => screen.getByLabelText("ค้นหาช่าง");

    fireEvent.change(box(), { target: { value: "สมหญิง" } });
    expect(screen.getByText("สมหญิง ขยัน")).toBeInTheDocument();
    expect(screen.queryByText("สมชาย ใจดี")).not.toBeInTheDocument();

    // Phone: the roster is how the office looks up "whose number is this".
    fireEvent.change(box(), { target: { value: "0812345678" } });
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.queryByText("สมหญิง ขยัน")).not.toBeInTheDocument();

    // Trade: by code AND by its Thai name.
    fireEvent.change(box(), { target: { value: "งานไฟฟ้า" } });
    expect(screen.getByText("ประสิทธิ์ ช่างไฟ")).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "W03" } });
    expect(screen.getByText("ประสิทธิ์ ช่างไฟ")).toBeInTheDocument();
  });

  it("says so when a search matches nobody", () => {
    renderRoster();
    fireEvent.change(screen.getByLabelText("ค้นหาช่าง"), { target: { value: "zzzz" } });
    expect(screen.getByText("ไม่พบช่างที่ค้นหา")).toBeInTheDocument();
  });

  it("an empty roster says so — it used to render nothing at all", () => {
    renderRoster([]);
    expect(screen.getByText("ยังไม่มีช่างในทะเบียน")).toBeInTheDocument();
    // …and the door to add the first one is still there.
    expect(screen.getByRole("button", { name: "เพิ่มช่าง" })).toBeInTheDocument();
  });

  it("แก้ไข opens that worker's editor in a sheet", () => {
    renderRoster([ROSTER[0]!]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข สมชาย ใจดี" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("ชื่อ")).toBeInTheDocument();
  });

  it("keeps the row's activate/deactivate control beside แก้ไข", () => {
    renderRoster([ROSTER[0]!]);
    expect(screen.getByRole("button", { name: "ปิดใช้งาน สมชาย ใจดี" })).toBeInTheDocument();
  });

  it("both row controls clear the 44px touch floor", () => {
    renderRoster([ROSTER[0]!]);
    for (const name of ["แก้ไข สมชาย ใจดี", "ปิดใช้งาน สมชาย ใจดี"]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
  });
});
