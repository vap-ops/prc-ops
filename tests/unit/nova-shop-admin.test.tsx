// Spec 161 U9 — NovaShopAdmin: the operator manages the shop catalog. Create an
// item (name + coin price), edit a price, toggle availability. Actions mocked —
// the contract is the create gate + args, the toggle args, refresh, inline error.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NovaShopAdmin } from "@/components/features/nova/nova-shop-admin";
import { upsertShopItem, setShopItemActive } from "@/lib/nova/shop-actions";

vi.mock("@/lib/nova/shop-actions", () => ({
  upsertShopItem: vi.fn(),
  setShopItemActive: vi.fn(),
}));
vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

import { refreshMock } from "../helpers/router-refresh";

const ITEMS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "หมวกนิรภัย",
    price_coins: 100,
    active: true,
  },
  { id: "22222222-2222-2222-2222-222222222222", name: "เสื้อทีม", price_coins: 250, active: false },
];

beforeEach(() => {
  vi.mocked(upsertShopItem).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(setShopItemActive).mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockReset();
});

describe("NovaShopAdmin", () => {
  it("disables create until a name and a positive price are present", async () => {
    render(<NovaShopAdmin items={ITEMS} />);
    const add = screen.getByRole("button", { name: "เพิ่มสินค้า" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("ชื่อสินค้า"), "รองเท้า");
    await userEvent.type(screen.getByLabelText("ราคา (เหรียญ)"), "180");
    expect(add).toBeEnabled();
  });

  it("creates an item via upsertShopItem and refreshes", async () => {
    render(<NovaShopAdmin items={ITEMS} />);
    await userEvent.type(screen.getByLabelText("ชื่อสินค้า"), "รองเท้า");
    await userEvent.type(screen.getByLabelText("ราคา (เหรียญ)"), "180");
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มสินค้า" }));

    await waitFor(() => expect(upsertShopItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(upsertShopItem).mock.calls[0]?.[0]).toMatchObject({
      name: "รองเท้า",
      priceCoins: 180,
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("toggles an active item off via setShopItemActive(id, false)", async () => {
    render(<NovaShopAdmin items={ITEMS} />);
    const row = screen.getByTestId("item-11111111-1111-1111-1111-111111111111");
    await userEvent.click(within(row).getByRole("button", { name: "ปิด" }));
    await waitFor(() =>
      expect(setShopItemActive).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", false),
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a create error inline", async () => {
    vi.mocked(upsertShopItem).mockResolvedValue({ ok: false, error: "ราคาต้องมากกว่า 0" });
    render(<NovaShopAdmin items={ITEMS} />);
    await userEvent.type(screen.getByLabelText("ชื่อสินค้า"), "ของแถม");
    await userEvent.type(screen.getByLabelText("ราคา (เหรียญ)"), "5");
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มสินค้า" }));
    await waitFor(() => expect(screen.getByText("ราคาต้องมากกว่า 0")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
