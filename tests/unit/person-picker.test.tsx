// Spec 363 U4 slice 1b — PersonPicker. The เบิก sheet's ผู้รับ field was the last
// long native <select> on that surface: slice 1 moved the material field to a
// searchable sheet and left the receiver on the OS wheel, so two adjacent fields
// asked for the same kind of answer in two different idioms (operator 2026-07-27:
// "we want the uxui to be consistent"). This is the plain analogue of
// ScopedCatalogItemPicker — search + names, no thumbnails and no filter chips,
// because a person has neither a picture nor a category on this surface.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PersonPicker } from "@/components/features/common/person-picker";

const people = [
  { id: "w1", name: "นางสาว สังวาลย์ มาลา" },
  { id: "w2", name: "นางสาว สายฝน เข็มวงศ์" },
  { id: "w3", name: "จรูญ โสภา" },
];

function renderPicker(
  opts: {
    selectedId?: string;
    onChange?: (id: string) => void;
    people?: { id: string; name: string }[];
    disabled?: boolean;
  } = {},
) {
  const onChange = opts.onChange ?? vi.fn();
  render(
    <PersonPicker
      label="ผู้รับ (ถ้ามี)"
      people={opts.people ?? people}
      selectedId={opts.selectedId ?? ""}
      onChange={onChange}
      disabled={opts.disabled ?? false}
      restingLabel="ไม่ระบุ"
      clearLabel="ไม่ระบุ"
      searchPlaceholder="ค้นหาชื่อ"
      sheetTitle="เลือกผู้รับ"
      emptyRosterLabel="ยังไม่มีช่างในโครงการนี้"
    />,
  );
  return { onChange };
}

// The trigger's accessible name is "<field label> <trigger text>" via
// aria-labelledby, so N receiver rows are distinguishable to a screen reader.
const TRIGGER = /ผู้รับ \(ถ้ามี\).*ไม่ระบุ/;
const CHANGE = /ผู้รับ \(ถ้ามี\).*เปลี่ยน/;

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: TRIGGER }));
  return screen.getByRole("dialog");
}

describe("PersonPicker (spec 363 U4 slice 1b)", () => {
  it("renders a trigger, not a native select — with the sheet open too", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: TRIGGER })).toBeInTheDocument();
    expect(document.querySelector("select")).toBeNull();
    // The list lives in the SHEET, so a closed-sheet assertion could only ever
    // catch a select in the trigger row. Re-assert where a select would be.
    const sheet = openSheet();
    expect(within(sheet).getByPlaceholderText("ค้นหาชื่อ")).toBeInTheDocument();
    expect(sheet.querySelector("select")).toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });

  it("associates the field label with the control for screen readers", () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: TRIGGER });
    const ids = (trigger.getAttribute("aria-labelledby") ?? "").split(" ").filter(Boolean);
    expect(ids).toHaveLength(2);
    const labelEl = document.getElementById(ids[0]!);
    expect(labelEl).not.toBeNull();
    expect(labelEl).toHaveTextContent("ผู้รับ (ถ้ามี)");
    expect(document.getElementById(ids[1]!)).toBe(trigger);
  });

  it("rests on the current answer, not a command", () => {
    renderPicker();
    // The old <select> displayed "ไม่ระบุ" at rest. An optional field that rests
    // on an imperative reads as an unfilled required one.
    expect(screen.getByRole("button", { name: TRIGGER })).toHaveTextContent("ไม่ระบุ");
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
    expect(screen.getByRole("button", { name: CHANGE })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TRIGGER })).toBeNull();
  });

  it("offers a clear row that reports the empty selection", () => {
    const { onChange } = renderPicker({ selectedId: "w1" });
    fireEvent.click(screen.getByRole("button", { name: CHANGE }));
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
    fireEvent.click(screen.getByRole("button", { name: CHANGE }));
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

  it("blames the roster, not the query, when there is nobody to pick", () => {
    renderPicker({ people: [] });
    const sheet = openSheet();
    expect(within(sheet).getByText("ยังไม่มีช่างในโครงการนี้")).toBeInTheDocument();
    expect(within(sheet).queryByText(/ไม่พบชื่อที่ค้นหา/)).toBeNull();
  });

  it("focuses the search on open so picking a person costs one tap, like วัสดุ", async () => {
    renderPicker();
    const sheet = openSheet();
    const search = within(sheet).getByPlaceholderText("ค้นหาชื่อ");
    // rAF, mirroring the material picker — flush it.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(search).toHaveFocus();
  });

  it("returns focus to the field on close so Tab resumes mid-form", () => {
    // Stateful wrapper: the real parent feeds selectedId back, so picking swaps
    // the trigger for เปลี่ยน. A mock-onChange fixture would never swap branches
    // and would quietly test the wrong element.
    function Harness() {
      const [id, setId] = useState("");
      return (
        <PersonPicker
          label="ผู้รับ (ถ้ามี)"
          people={people}
          selectedId={id}
          onChange={setId}
          restingLabel="ไม่ระบุ"
          clearLabel="ไม่ระบุ"
          searchPlaceholder="ค้นหาชื่อ"
          sheetTitle="เลือกผู้รับ"
          emptyRosterLabel="ยังไม่มีช่างในโครงการนี้"
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: TRIGGER }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /จรูญ/ }));
    // Picking closes the sheet AND swaps the branch; focus must land on the new
    // control, not on <body>.
    expect(screen.getByRole("button", { name: CHANGE })).toHaveFocus();
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

  it("keeps a selection the roster no longer contains visible instead of reading as empty", () => {
    // The parent still holds the id and still submits it, so falling through to
    // the unselected branch would show "ไม่ระบุ" while the payload named someone.
    renderPicker({ selectedId: "ghost" });
    expect(screen.getByText(/ไม่อยู่ในรายชื่อแล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TRIGGER })).toBeNull();
    expect(screen.getByRole("button", { name: CHANGE })).toBeInTheDocument();
  });

  it("is inert while the parent form is submitting — in both branches", () => {
    const { unmount } = render(<div />);
    unmount();
    renderPicker({ disabled: true });
    const trigger = screen.getByRole("button", { name: TRIGGER });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables the เปลี่ยน control too, not just the empty-state trigger", () => {
    renderPicker({ selectedId: "w1", disabled: true });
    expect(screen.getByRole("button", { name: CHANGE })).toBeDisabled();
  });

  it("keeps an already-open sheet inert if the form starts submitting", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PersonPicker
        label="ผู้รับ (ถ้ามี)"
        people={people}
        selectedId=""
        onChange={onChange}
        restingLabel="ไม่ระบุ"
        clearLabel="ไม่ระบุ"
        searchPlaceholder="ค้นหาชื่อ"
        sheetTitle="เลือกผู้รับ"
        emptyRosterLabel="ยังไม่มีช่างในโครงการนี้"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: TRIGGER }));
    rerender(
      <PersonPicker
        label="ผู้รับ (ถ้ามี)"
        people={people}
        selectedId=""
        onChange={onChange}
        disabled
        restingLabel="ไม่ระบุ"
        clearLabel="ไม่ระบุ"
        searchPlaceholder="ค้นหาชื่อ"
        sheetTitle="เลือกผู้รับ"
        emptyRosterLabel="ยังไม่มีช่างในโครงการนี้"
      />,
    );
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /จรูญ/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
