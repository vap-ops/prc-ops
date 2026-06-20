"use client";

// Spec 161 U9 — the operator manages the Nova shop catalog: create an item
// (name + coin price), edit a price, toggle availability. Prices are coins (points,
// no baht peg). Writes relay to the SECURITY DEFINER RPCs (upsert_shop_item /
// set_shop_item_active) via the RLS server client; super_admin only (page-gated).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertShopItem, setShopItemActive } from "@/lib/nova/shop-actions";
import { CARD, FIELD_STACKED, SECTION_HEADING } from "@/lib/ui/classes";

const BTN =
  "bg-fill text-on-fill hover:bg-fill-press inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors active:translate-y-px disabled:opacity-50";
const BTN_GHOST =
  "border-edge text-ink hover:bg-sunk inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export type ShopItem = { id: string; name: string; price_coins: number; active: boolean };

function CreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceNum = Number(price);
  const canSubmit = name.trim().length > 0 && Number.isFinite(priceNum) && priceNum > 0;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const r = await upsertShopItem({ name: name.trim(), priceCoins: priceNum });
    setBusy(false);
    if (r.ok) {
      setName("");
      setPrice("");
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  return (
    <div className={CARD}>
      <h2 className={SECTION_HEADING}>เพิ่มสินค้าใหม่</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-ink-secondary block text-sm">
          ชื่อสินค้า
          <input
            type="text"
            aria-label="ชื่อสินค้า"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
        <label className="text-ink-secondary block text-sm">
          ราคา (เหรียญ)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step="any"
            aria-label="ราคา (เหรียญ)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
      </div>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !canSubmit}
        onClick={() => void submit()}
        className={`${BTN} mt-3`}
      >
        เพิ่มสินค้า
      </button>
    </div>
  );
}

function ItemRow({ item }: { item: ShopItem }) {
  const router = useRouter();
  const [price, setPrice] = useState(String(item.price_coins));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(p: Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    const r = await p;
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <li data-testid={`item-${item.id}`} className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink min-w-0 truncate text-sm font-semibold">{item.name}</span>
        <span
          className={`shrink-0 text-xs font-semibold ${item.active ? "text-done-strong" : "text-ink-muted"}`}
        >
          {item.active ? "เปิดขาย" : "ปิดอยู่"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-ink-secondary block text-sm">
          ราคา
          <input
            type="number"
            min={1}
            step="any"
            aria-label={`ราคา ${item.name}`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(upsertShopItem({ id: item.id, name: item.name, priceCoins: Number(price) }))
          }
          className={BTN}
        >
          บันทึกราคา
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(setShopItemActive(item.id, !item.active))}
          className={BTN_GHOST}
        >
          {item.active ? "ปิด" : "เปิด"}
        </button>
      </div>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
    </li>
  );
}

export function NovaShopAdmin({ items }: { items: ShopItem[] }) {
  return (
    <div className="flex flex-col gap-6">
      <CreateForm />
      <div>
        <h2 className={SECTION_HEADING}>สินค้าในร้าน</h2>
        {items.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-3">
            {items.map((it) => (
              <ItemRow key={it.id} item={it} />
            ))}
          </ul>
        ) : (
          <p className="text-ink-secondary mt-2 text-sm">ยังไม่มีสินค้า</p>
        )}
      </div>
    </div>
  );
}
