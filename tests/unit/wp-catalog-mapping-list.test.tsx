// Spec 389 U4 — MappingList behaviour: suggestion → ยืนยัน writes the
// suggested item; mapped rows RE-PICK directly (the star-MOVE arm's only door);
// ล้าง is 2-tap confirmed; the picker submits from the explicit button, never
// from the select's onChange.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  MappingList,
  type MappingItemOption,
  type MappingRowData,
} from "@/components/features/wp-catalog/mapping-list";

const mapWpToCatalog = vi.fn();
vi.mock("@/app/projects/[projectId]/catalog-mapping/actions", () => ({
  mapWpToCatalog: (...args: unknown[]) => mapWpToCatalog(...args) as unknown,
}));

const items: MappingItemOption[] = [
  { id: "i-leaf", code: "S-01-01", name: "งานมาตรฐานหนึ่ง", isGroup: false },
  { id: "i-leaf2", code: "S-01-02", name: "งานมาตรฐานสอง", isGroup: false },
  { id: "i-grp", code: "S-01", name: "กลุ่มมาตรฐาน", isGroup: true },
];

const row = (o: Partial<MappingRowData> & { id: string }): MappingRowData => ({
  code: "WP-01-01",
  name: "งานทดสอบ",
  isGroup: false,
  currentItemId: null,
  suggestionItemId: null,
  suggestionBasis: null,
  ...o,
});

beforeEach(() => {
  mapWpToCatalog.mockReset();
  mapWpToCatalog.mockResolvedValue({ ok: true, starsMoved: 0, starsRetired: 0 });
});

describe("MappingList", () => {
  it("ยืนยัน submits the SUGGESTED item id for the right WP", async () => {
    render(
      <MappingList
        projectId="p1"
        rows={[row({ id: "w1", suggestionItemId: "i-leaf", suggestionBasis: "old_id" })]}
        items={items}
      />,
    );
    expect(screen.getByText(/จากรหัสเดิม/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    });
    expect(mapWpToCatalog).toHaveBeenCalledWith("p1", "w1", "i-leaf");
  });

  it("ล้างการจับคู่ requires the 2-tap confirm and then submits null", async () => {
    render(
      <MappingList
        projectId="p1"
        rows={[row({ id: "w2", currentItemId: "i-leaf" })]}
        items={items}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ล้างการจับคู่" }));
    });
    // first tap arms the confirm — nothing submitted yet
    expect(mapWpToCatalog).not.toHaveBeenCalled();
    expect(screen.getByText(/ดาวรูปตัวอย่างของงานนี้จะถูกลบด้วย/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ยืนยันการล้าง" }));
    });
    expect(mapWpToCatalog).toHaveBeenCalledWith("p1", "w2", null);
  });

  it("a MAPPED row re-picks DIRECTLY via เปลี่ยน — never clear-then-map", async () => {
    render(
      <MappingList
        projectId="p1"
        rows={[row({ id: "w4", currentItemId: "i-leaf" })]}
        items={items}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    });
    const select = screen.getByLabelText(/เลือกงานมาตรฐานสำหรับ/);
    await act(async () => {
      fireEvent.change(select, { target: { value: "i-leaf2" } });
    });
    // changing the select alone submits NOTHING — the explicit button does
    expect(mapWpToCatalog).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ยืนยันตัวเลือก" }));
    });
    expect(mapWpToCatalog).toHaveBeenCalledWith("p1", "w4", "i-leaf2");
  });

  it("เลือกเอง offers only same-grain options and submits via the button", async () => {
    render(<MappingList projectId="p1" rows={[row({ id: "w3" })]} items={items} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "เลือกเอง" }));
    });
    const select = screen.getByLabelText(/เลือกงานมาตรฐานสำหรับ/);
    const optionTexts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(optionTexts.some((t) => t?.includes("กลุ่มมาตรฐาน"))).toBe(false);
    expect(optionTexts.some((t) => t?.includes("งานมาตรฐานสอง"))).toBe(true);

    await act(async () => {
      fireEvent.change(select, { target: { value: "i-leaf2" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ยืนยันตัวเลือก" }));
    });
    expect(mapWpToCatalog).toHaveBeenCalledWith("p1", "w3", "i-leaf2");
  });

  it("splits mapped and unmapped into the two sections with counts", () => {
    render(
      <MappingList
        projectId="p1"
        rows={[row({ id: "w1" }), row({ id: "w2", currentItemId: "i-leaf" })]}
        items={items}
      />,
    );
    expect(screen.getByText("ยังไม่จับคู่ (1)")).toBeInTheDocument();
    expect(screen.getByText("จับคู่แล้ว (1)")).toBeInTheDocument();
  });

  it("a failed action surfaces the error as role=alert", async () => {
    mapWpToCatalog.mockResolvedValue({
      ok: false,
      error: "เฉพาะผู้อำนวยการโครงการเท่านั้นที่จับคู่งานได้",
    });
    render(
      <MappingList
        projectId="p1"
        rows={[row({ id: "w1", suggestionItemId: "i-leaf", suggestionBasis: "name" })]}
        items={items}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("เฉพาะผู้อำนวยการโครงการ");
  });

  it("retired stars are reported to the PD after a confirmed clear", async () => {
    mapWpToCatalog.mockResolvedValue({ ok: true, starsMoved: 0, starsRetired: 2 });
    render(
      <MappingList
        projectId="p1"
        rows={[row({ id: "w2", currentItemId: "i-leaf" })]}
        items={items}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ล้างการจับคู่" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ยืนยันการล้าง" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("ลบดาวรูปตัวอย่างของงานนี้ 2 รายการ");
  });
});
