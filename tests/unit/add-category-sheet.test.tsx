// Spec 207 U3 — the "add หมวดงาน" sheet. Opens a form, gates submit on a valid
// code + name, calls createProjectCategory with the trimmed values, refreshes on
// success, and surfaces an inline error on failure.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

type CreateInput = { projectId: string; code: string; name: string };
const createProjectCategory = vi.fn(
  async (_input: CreateInput) =>
    ({ ok: true, id: "c1" }) as { ok: true; id: string } | { ok: false; error: string },
);
vi.mock("@/app/projects/[projectId]/actions", () => ({
  createProjectCategory: (input: CreateInput) => createProjectCategory(input),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AddCategorySheet } from "@/app/projects/[projectId]/add-category-sheet";

function openSheet() {
  render(<AddCategorySheet projectId="p1" />);
  fireEvent.click(screen.getByRole("button", { name: "+ เพิ่มหมวดงาน" }));
}

describe("AddCategorySheet", () => {
  beforeEach(() => {
    createProjectCategory.mockClear();
    createProjectCategory.mockResolvedValue({ ok: true, id: "c1" });
    refresh.mockClear();
  });

  it("disables submit until both code and name are filled", () => {
    openSheet();
    const submit = screen.getByRole("button", { name: "สร้างหมวดงาน" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("รหัสหมวด"), { target: { value: "STRUCT" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("ชื่อหมวด"), { target: { value: "งานโครงสร้าง" } });
    expect(submit).not.toBeDisabled();
  });

  it("creates the category with the entered values, then refreshes", async () => {
    openSheet();
    fireEvent.change(screen.getByLabelText("รหัสหมวด"), { target: { value: "STRUCT" } });
    fireEvent.change(screen.getByLabelText("ชื่อหมวด"), { target: { value: "งานโครงสร้าง" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างหมวดงาน" }));
    await waitFor(() =>
      expect(createProjectCategory).toHaveBeenCalledWith({
        projectId: "p1",
        code: "STRUCT",
        name: "งานโครงสร้าง",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("surfaces an inline error on failure and does not refresh", async () => {
    createProjectCategory.mockResolvedValue({ ok: false, error: "รหัสหมวดนี้มีอยู่แล้วในโครงการ" });
    openSheet();
    fireEvent.change(screen.getByLabelText("รหัสหมวด"), { target: { value: "DUP" } });
    fireEvent.change(screen.getByLabelText("ชื่อหมวด"), { target: { value: "ซ้ำ" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้างหมวดงาน" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("รหัสหมวดนี้มีอยู่แล้วในโครงการ");
    expect(refresh).not.toHaveBeenCalled();
  });
});
