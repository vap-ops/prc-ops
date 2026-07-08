import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Spec 279 U4 — the SA's phoneless เพิ่มเอง form. The server action + next/navigation
// are mocked (browser-only / server-only) so this stays a pure render/gate test.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/sa/crew/actions", () => ({
  addProjectWorker: vi.fn(async () => ({ ok: true })),
}));

import { AddWorkerForm } from "@/components/features/sa/add-worker-form";

describe("AddWorkerForm", () => {
  it("renders the phoneless-add fields", () => {
    render(<AddWorkerForm projects={[{ id: "p1", code: "TFM" }]} />);
    expect(screen.getByLabelText("เลขบัตรประชาชน")).toBeInTheDocument();
    expect(screen.getByLabelText("วันเกิด")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มช่าง" })).toBeInTheDocument();
  });

  it("keeps submit disabled until name + 13-digit ID + DOB are filled", () => {
    render(<AddWorkerForm projects={[{ id: "p1", code: "TFM" }]} />);
    expect(screen.getByRole("button", { name: "เพิ่มช่าง" })).toBeDisabled();
  });

  it("hides the project picker for a single-project SA", () => {
    render(<AddWorkerForm projects={[{ id: "p1", code: "TFM" }]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
