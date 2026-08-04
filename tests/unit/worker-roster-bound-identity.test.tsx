// Writing failing test first.
//
// Spec 396 U2 — the edit sheet NAMES the account holder of a portal-bound
// worker record.
//
// Why: on 2026-08-04 procurement, looking for one worker, opened a DIFFERENT
// worker's record and renamed it — overwriting a real employee's identity. The
// sheet's only ownership cues were the bank lock and a "เชื่อมบัญชีพอร์ทัลแล้ว"
// card, neither of which says WHOSE account it is, and the page deliberately
// stripped user_id so the client could not have said.
//
// The line renders directly under the ชื่อ input — the field where the mistake
// is actually made — not in the portal card at the bottom of the sheet.
//
// ⚠️ Copy must NOT accuse: ten of the eleven real renames on bound workers in
// the incident window were legitimate prefix normalisations. This states a fact
// about the record; it never warns.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock("@/lib/telemetry/friction", () => ({ trackFriction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/workers/actions", () => ({
  createWorker: vi.fn(),
  updateWorker: vi.fn(),
  setWorkerDayRate: vi.fn(),
  assignWorkerToProject: vi.fn(),
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

const BASE: ManagedWorker = {
  id: "w1",
  name: "ช่างหนึ่ง",
  pay_type: "daily",
  contractor_id: null,
  day_rate: 500,
  active: true,
  note: null,
  employment_type: "temporary",
  portalBound: false,
  boundUserName: null,
  project_id: null,
  level: null,
  cost_confirmed_at: null,
  phone: null,
  tax_id: null,
  bank_name: null,
  bank_account_number: null,
  bank_account_name: null,
  gender: null,
  trades: [],
};

function openEditSheet() {
  fireEvent.click(screen.getByRole("button", { name: /^แก้ไข/ }));
}

describe("WorkerRosterManager — spec 396 U2, naming the bound account holder", () => {
  it("names the account holder on a bound worker's edit sheet", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...BASE, id: "wb", portalBound: true, boundUserName: "เอมอร ฮามศรีพรม" }]}
        contractors={[]}
      />,
    );
    openEditSheet();

    // The whole point of the unit: the person's name, on screen, at the field
    // where a rename happens.
    expect(screen.getByText(/เอมอร ฮามศรีพรม/)).toBeInTheDocument();
  });

  it("still states the record is owned when the holder's name is unknown", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...BASE, id: "wb", portalBound: true, boundUserName: null }]}
        contractors={[]}
      />,
    );
    openEditSheet();

    // A missing display name must not silently hide the ownership FACT — that
    // is the signal, the name is the detail.
    expect(screen.getByText(/ผูกบัญชีเข้าแอปแล้ว/)).toBeInTheDocument();
  });

  it("says nothing about ownership on an unbound worker", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...BASE, id: "wu", portalBound: false, boundUserName: null }]}
        contractors={[]}
      />,
    );
    openEditSheet();

    expect(screen.queryByText(/ผูกบัญชีเข้าแอปแล้ว/)).not.toBeInTheDocument();
  });

  it("does not accuse — no warning words in the ownership line", () => {
    render(
      <WorkerRosterManager
        workers={[{ ...BASE, id: "wb", portalBound: true, boundUserName: "เอมอร ฮามศรีพรม" }]}
        contractors={[]}
      />,
    );
    openEditSheet();

    const line = screen.getByText(/เอมอร ฮามศรีพรม/).textContent ?? "";
    for (const word of ["ระวัง", "ห้าม", "ผิด", "เตือน", "อันตราย"]) {
      expect(line).not.toContain(word);
    }
  });
});
