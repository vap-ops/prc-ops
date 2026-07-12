// Writing failing test first.
//
// Spec 307/308 — the ของเข้า list renders DAY sections (arrival grain), one card
// per (day × supplier) arrival so the SA can count packages/day; each delivery
// inside an arrival keeps a spec-308 รับของ receive link. Day header = Thai date
// (+ วันนี้ / เลยกำหนด / unscheduled last) + arrival count; the top badge counts
// arrival cards.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StoreIncomingList } from "@/components/features/store/store-incoming-list";
import { selectIncomingArrivals, type RawStoreIncoming } from "@/lib/store/incoming";
import {
  STORE_INCOMING_DAY_TODAY,
  STORE_INCOMING_DAY_UNSCHEDULED,
  DELIVERY_OVERDUE_FLAG,
  DELIVERY_RECEIVE_PAGE_TITLE,
} from "@/lib/i18n/labels";

const TODAY = "2026-07-12";

const raw = (
  id: string,
  eta: string | null,
  supplier: string | null,
  deliveryId: string | null = null,
  base = "ปูน",
): RawStoreIncoming => ({
  id,
  item_description: "รายการอิสระ",
  quantity: 10,
  unit: "ถุง",
  eta,
  status: "on_route",
  supplier,
  delivery_id: deliveryId,
  catalog_items: { base_item: base, spec_attrs: null },
});

const hrefFor = (l: string) => `/x?incoming=${l}`;
const receiveHrefFor = (deliveryId: string) => `/recv/${deliveryId}`;

describe("StoreIncomingList (spec 307 day sections)", () => {
  it("renders day headers with arrival counts; top badge = total cards", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "2026-07-11", "ร้านวัสดุ"), // overdue day
        raw("b", "2026-07-12", "ร้านวัสดุ"), // today, arrival 1
        raw("c", "2026-07-12", "ร้านวัสดุ", null, "ทราย"), // today, same arrival
        raw("d", "2026-07-12", "ร้านเหล็กไทย"), // today, arrival 2
        raw("e", null, null), // unscheduled
      ],
      "all",
      TODAY,
    );
    render(<StoreIncomingList days={days} lens="all" hrefFor={hrefFor} />);

    // 4 arrivals total: overdue(1) + today(2) + unscheduled(1). The top badge and
    // day chips carry DISTINCT accessible names (total vs a single day's shipments).
    expect(screen.getByText("4")).toHaveAccessibleName("จำนวนของเข้าทั้งหมด: 4");
    // Today has 2 arrivals — its day chip reads the day-shipment name, not the total.
    expect(screen.getByLabelText("จำนวนเที่ยวส่ง: 2")).toBeInTheDocument();

    const headers = screen.getAllByRole("heading", { level: 3 });
    expect(headers.length).toBe(3);
    expect(headers[0]?.textContent).toContain(DELIVERY_OVERDUE_FLAG);
    expect(headers[1]?.textContent).toContain(STORE_INCOMING_DAY_TODAY);
    expect(headers[2]?.textContent).toContain(STORE_INCOMING_DAY_UNSCHEDULED);

    const todaySection = headers[1]!.closest("section")!;
    expect(within(todaySection).getByText("ร้านเหล็กไทย")).toBeInTheDocument();
    expect(within(todaySection).getByText("· 2 รายการ")).toBeInTheDocument();
  });

  it("renders a spec-308 รับของ link per delivery when receiveHrefFor is set", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "2026-07-12", "ร้านวัสดุ", "d1"),
        raw("b", "2026-07-12", "ร้านวัสดุ", "d2"), // same arrival, 2nd delivery
      ],
      "all",
      TODAY,
    );
    render(
      <StoreIncomingList
        days={days}
        lens="all"
        hrefFor={hrefFor}
        receiveHrefFor={receiveHrefFor}
      />,
    );
    const receiveLinks = screen.getAllByRole("link", {
      name: new RegExp(DELIVERY_RECEIVE_PAGE_TITLE),
    });
    expect(receiveLinks.map((l) => l.getAttribute("href"))).toEqual(["/recv/d1", "/recv/d2"]);
  });

  it("spec 307 U2 — items are a plain manifest, NOT deep-links into procurement (/requests)", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "2026-07-12", "ร้านวัสดุ", "d1"), // delivery-backed
        raw("b", "2026-07-12", "ร้านวัสดุ", null), // delivery-less
      ],
      "all",
      TODAY,
    );
    render(
      <StoreIncomingList
        days={days}
        lens="all"
        hrefFor={hrefFor}
        receiveHrefFor={receiveHrefFor}
      />,
    );
    // The item text renders...
    expect(screen.getAllByText(/ปูน/).length).toBeGreaterThanOrEqual(2);
    // ...but NO link points into /requests (จัดซื้อ) — receiving is the only navigation.
    const links = screen.getAllByRole("link");
    expect(links.every((l) => !(l.getAttribute("href") ?? "").startsWith("/requests"))).toBe(true);
  });

  it("spec 307 U2 — receiving is the only action: รับของ present, no /requests link", () => {
    const days = selectIncomingArrivals([raw("a", "2026-07-12", "ร้านวัสดุ", "d1")], "all", TODAY);
    render(
      <StoreIncomingList
        days={days}
        lens="all"
        hrefFor={hrefFor}
        receiveHrefFor={receiveHrefFor}
      />,
    );
    // The receive link's accessible name is exactly "รับของ →" — the decorative
    // store icon inside it must NOT pollute the name with "คลัง".
    const receiveLink = screen.getByRole("link", { name: `${DELIVERY_RECEIVE_PAGE_TITLE} →` });
    expect(receiveLink).toHaveAttribute("href", "/recv/d1");
    expect(screen.queryByRole("link", { name: /ปูน/ })).toBeNull();
  });

  it("spec 307 U2 — shows the store (คลัง) symbol on the heading + the รับของ action (decorative)", () => {
    const days = selectIncomingArrivals([raw("a", "2026-07-12", "ร้านวัสดุ", "d1")], "all", TODAY);
    render(
      <StoreIncomingList
        days={days}
        lens="all"
        hrefFor={hrefFor}
        receiveHrefFor={receiveHrefFor}
      />,
    );
    // The store symbol appears on the heading (surface identity) AND on the รับของ
    // action (receiving → store) so the SA learns the store icon — visually.
    const symbols = screen.getAllByTestId("incoming-store-symbol");
    expect(symbols.length).toBeGreaterThanOrEqual(2);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(within(heading).getByTestId("incoming-store-symbol")).toBeInTheDocument();
    const receiveLink = screen.getByRole("link", { name: `${DELIVERY_RECEIVE_PAGE_TITLE} →` });
    expect(within(receiveLink).getByTestId("incoming-store-symbol")).toBeInTheDocument();
    // Decorative: aria-hidden, so it contributes no accessible name — the heading
    // reads exactly "ของเข้า", not "คลัง ของเข้า".
    expect(symbols[0]).toHaveAttribute("aria-hidden");
    expect(heading).toHaveAccessibleName("ของเข้า");
  });

  it("empty state renders when no arrivals survive the lens", () => {
    render(<StoreIncomingList days={[]} lens="today" hrefFor={hrefFor} />);
    expect(screen.getByText("ไม่มีของกำลังเข้าในตัวกรองนี้")).toBeInTheDocument();
  });
});
