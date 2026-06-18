// Writing failing test first.
//
// Spec 142 U2 — the "New project" stub sheet on /projects. PM/super open it,
// the code is prefilled from suggest_project_code (editable), name is required,
// type + client are optional. On success it navigates to the new project page.
// Mocked server action + router (the createProject action + create_project RPC
// are the load-bearing validators; this test covers the wiring).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockPush } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("@/app/projects/actions", () => ({ createProject: mockCreate }));

import { NewProjectSheet } from "@/app/projects/new-project-sheet";

const CLIENTS = [
  { id: "cl1", name: "ลูกค้า เอ" },
  { id: "cl2", name: "ลูกค้า บี" },
];

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true, id: "new-99" });
  mockPush.mockReset();
});

function open(suggestedCode = "PRC-2026-007") {
  render(<NewProjectSheet suggestedCode={suggestedCode} clients={CLIENTS} />);
  fireEvent.click(screen.getByRole("button", { name: /เพิ่มโครงการ/ }));
}

describe("NewProjectSheet", () => {
  it("prefills the code field with the suggested code when opened", () => {
    open("PRC-2026-007");
    expect(screen.getByLabelText("รหัสโครงการ")).toHaveValue("PRC-2026-007");
  });

  it("disables submit until a name is entered", () => {
    open();
    const submit = screen.getByRole("button", { name: "สร้างโครงการ" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("ชื่อโครงการ"), {
      target: { value: "บ้านคุณสมชาย" },
    });
    expect(submit).toBeEnabled();
  });

  it("creates the project and navigates to its page on success", async () => {
    open("PRC-2026-007");
    fireEvent.change(screen.getByLabelText("ชื่อโครงการ"), {
      target: { value: "บ้านคุณสมชาย" },
    });
    fireEvent.click(screen.getByRole("button", { name: "สร้างโครงการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        code: "PRC-2026-007",
        name: "บ้านคุณสมชาย",
        projectType: "",
        clientId: "",
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/projects/new-99"));
  });

  it("passes an edited code and selected type/client through", async () => {
    open("PRC-2026-007");
    fireEvent.change(screen.getByLabelText("รหัสโครงการ"), {
      target: { value: "PRC-2026-099" },
    });
    fireEvent.change(screen.getByLabelText("ชื่อโครงการ"), {
      target: { value: "โรงงานบางนา" },
    });
    fireEvent.change(screen.getByLabelText("ประเภทโครงการ"), {
      target: { value: "factory_warehouse" },
    });
    fireEvent.change(screen.getByLabelText("ลูกค้า / เจ้าของโครงการ"), {
      target: { value: "cl2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "สร้างโครงการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        code: "PRC-2026-099",
        name: "โรงงานบางนา",
        projectType: "factory_warehouse",
        clientId: "cl2",
      }),
    );
  });

  it("shows the action error inline and does not navigate", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "รหัสโครงการนี้มีอยู่แล้ว" });
    open();
    fireEvent.change(screen.getByLabelText("ชื่อโครงการ"), {
      target: { value: "ซ้ำรหัส" },
    });
    fireEvent.click(screen.getByRole("button", { name: "สร้างโครงการ" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("รหัสโครงการนี้มีอยู่แล้ว"),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
