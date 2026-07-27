// Spec 363 U4 slice 1b — PersonPicker. The เบิก sheet's ผู้รับ field was the last
// long native <select> on that surface: slice 1 moved the material field to a
// searchable sheet and left the receiver on the OS wheel, so two adjacent fields
// asked for the same kind of answer in two different idioms (operator 2026-07-27:
// "we want the uxui to be consistent"). This is the plain analogue of
// ScopedCatalogItemPicker — search + names, no thumbnails and no filter chips,
// because a person has neither a picture nor a category on this surface.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PersonPicker } from "@/components/features/common/person-picker";

const people = [
  { id: "w1", name: "นางสาว สังวาลย์ มาลา" },
  { id: "w2", name: "นางสาว สายฝน เข็มวงศ์" },
  { id: "w3", name: "จรูญ โสภา" },
];

function renderPicker(opts: { selectedId?: string; onChange?: (id: string) => void } = {}) {
  const onChange = opts.onChange ?? vi.fn();
  render(
    <PersonPicker
      label="ผู้รับ (ถ้ามี)"
      people={people}
      selectedId={opts.selectedId ?? ""}
      onChange={onChange}
      triggerLabel="เลือกผู้รับ"
      clearLabel="ไม่ระบุ"
      searchPlaceholder="ค้นหาชื่อ"
      sheetTitle="เลือกผู้รับ"
    />,
  );
  return { onChange };
}

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: "เลือกผู้รับ" }));
  return screen.getByRole("dialog");
}

describe("PersonPicker (spec 363 U4 slice 1b)", () => {
  it("renders a trigger, not a native select", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "เลือกผู้รับ" })).toBeInTheDocument();
    // The whole point of the unit: no OS wheel on this field.
    expect(document.querySelector("select")).toBeNull();
  });

  it("shows the field label so the row still reads as a form field", () => {
    renderPicker();
    expect(screen.getByText("ผู้รับ (ถ้ามี)")).toBeInTheDocument();
  });

  it("opens a sheet with a search box and every person listed", () => {
    renderPicker();
    const sheet = openSheet();
    expect(within(sheet).getByPlaceholderText("ค้นหาชื่อ")).toBeInTheDocument();
    for (const p of people) {
      expect(within(sheet).getByRole("button", { name: new RegExp(p.name) })).toBeInTheDocument();
    }
  });

  it("filters the list to the typed query", () => {
    renderPicker();
    const sheet = openSheet();
    fireEvent.change(within(sheet).getByPlaceholderText("ค้นหาชื่อ"), {
      target: { value: "สายฝน" },
    });
    expect(within(sheet).getByRole("button", { name: /สายฝน/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /สังวาลย์/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /จรูญ/ })).toBeNull();
  });

  it("reports the picked person and closes the sheet", () => {
    const { onChange } = renderPicker();
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: /สังวาลย์/ }));
    expect(onChange).toHaveBeenCalledWith("w1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the selected person with a เปลี่ยน control instead of the trigger", () => {
    renderPicker({ selectedId: "w2" });
    expect(screen.getByText("นางสาว สายฝน เข็มวงศ์")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปลี่ยน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เลือกผู้รับ" })).toBeNull();
  });

  it("offers a clear row that reports the empty selection", () => {
    const { onChange } = renderPicker({ selectedId: "w1" });
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    // เปลี่ยน must NOT clear on the way in — backing out of the sheet has to
    // leave a correct answer standing. Without this line the assertion below is
    // vacuous: a เปลี่ยน that cleared would satisfy it without the row existing.
    expect(onChange).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "ไม่ระบุ" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("keeps the clear row reachable even when the query matches nobody", () => {
    const { onChange } = renderPicker({ selectedId: "w1" });
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByPlaceholderText("ค้นหาชื่อ"), {
      target: { value: "zzz" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "ไม่ระบุ" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("highlights the matched part of the name", () => {
    renderPicker();
    const sheet = openSheet();
    fireEvent.change(within(sheet).getByPlaceholderText("ค้นหาชื่อ"), {
      target: { value: "สายฝน" },
    });
    const row = within(sheet).getByRole("button", { name: /สายฝน/ });
    const marked = row.querySelector(".text-action");
    expect(marked).not.toBeNull();
    expect(marked).toHaveTextContent("สายฝน");
  });

  it("says so when nothing matches instead of showing an empty sheet", () => {
    renderPicker();
    const sheet = openSheet();
    fireEvent.change(within(sheet).getByPlaceholderText("ค้นหาชื่อ"), {
      target: { value: "ไม่มีคนชื่อนี้" },
    });
    expect(within(sheet).getByText(/ไม่พบ/)).toBeInTheDocument();
  });

  it("reopens on a clean query so a stale filter never hides the list", () => {
    renderPicker();
    const sheet = openSheet();
    fireEvent.change(within(sheet).getByPlaceholderText("ค้นหาชื่อ"), {
      target: { value: "จรูญ" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: /จรูญ/ }));
    const reopened = openSheet();
    expect(within(reopened).getByPlaceholderText("ค้นหาชื่อ")).toHaveValue("");
    expect(within(reopened).getAllByRole("button", { name: /มาลา|เข็มวงศ์|โสภา/ })).toHaveLength(3);
  });

  it("is inert while the parent form is submitting", () => {
    render(
      <PersonPicker
        label="ผู้รับ (ถ้ามี)"
        people={people}
        selectedId=""
        onChange={vi.fn()}
        disabled
        triggerLabel="เลือกผู้รับ"
        clearLabel="ไม่ระบุ"
        searchPlaceholder="ค้นหาชื่อ"
        sheetTitle="เลือกผู้รับ"
      />,
    );
    expect(screen.getByRole("button", { name: "เลือกผู้รับ" })).toBeDisabled();
  });
});
