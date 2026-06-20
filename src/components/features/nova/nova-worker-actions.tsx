"use client";

// Spec 161 U12 — the operator's per-worker Nova actions: award the saver's bonus,
// redeem a shop item, and confiscate (narrow reasons, themed confirm — destructive).
// All relay to the SECURITY DEFINER super-only RPCs. The vesting/balance figures are
// read + shown by the page; this component is the action surface.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  awardSaversBonusAction,
  confiscateCoinsAction,
  redeemShopItemAction,
} from "@/lib/nova/worker-actions";
import {
  CONFISCATION_REASONS,
  CONFISCATION_REASON_LABEL,
  type ConfiscationReason,
} from "@/lib/nova/confiscation";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { CARD, FIELD_STACKED, SECTION_HEADING } from "@/lib/ui/classes";

const BTN =
  "bg-fill text-on-fill hover:bg-fill-press inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors active:translate-y-px disabled:opacity-50";
const DANGER_BTN =
  "border-danger text-danger hover:bg-danger-soft inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50";

type ShopItem = { id: string; name: string; price_coins: number };

function SaverBonusButton({ workerId }: { workerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    const r = await awardSaversBonusAction(workerId);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }
  return (
    <div className={CARD}>
      <h2 className={SECTION_HEADING}>โบนัสออม</h2>
      <p className="text-ink-secondary mt-1 text-xs">
        ให้รางวัลการถือเหรียญ (อัตราตามค่าปรับ — งดให้ถ้าใช้จ่ายหลังโบนัสครั้งก่อน)
      </p>
      <button type="button" disabled={busy} onClick={() => void go()} className={`${BTN} mt-3`}>
        มอบโบนัสออม
      </button>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
    </div>
  );
}

function RedeemForm({ workerId, items }: { workerId: string; items: ShopItem[] }) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    if (itemId === "") return;
    setBusy(true);
    setError(null);
    const r = await redeemShopItemAction(workerId, itemId);
    setBusy(false);
    if (r.ok) {
      setItemId("");
      router.refresh();
    } else {
      setError(r.error);
    }
  }
  return (
    <div className={CARD}>
      <h2 className={SECTION_HEADING}>แลกของรางวัล</h2>
      {items.length > 0 ? (
        <>
          <label className="text-ink-secondary mt-2 block text-sm">
            เลือกสินค้า
            <select
              aria-label="เลือกสินค้า"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className={FIELD_STACKED}
            >
              <option value="">— เลือก —</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} · {it.price_coins.toLocaleString("th-TH")} เหรียญ
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || itemId === ""}
            onClick={() => void go()}
            className={`${BTN} mt-3`}
          >
            แลกของรางวัล
          </button>
          {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
        </>
      ) : (
        <p className="text-ink-secondary mt-2 text-sm">ยังไม่มีสินค้าเปิดขาย</p>
      )}
    </div>
  );
}

function ConfiscateForm({ workerId }: { workerId: string }) {
  const [reason, setReason] = useState<ConfiscationReason>("fraud");
  const [note, setNote] = useState("");
  return (
    <div className={CARD}>
      <h2 className={SECTION_HEADING}>ริบเหรียญ</h2>
      <p className="text-ink-secondary mt-1 text-xs">
        ริบเฉพาะเหรียญที่ยังไม่สุกงอม — เหรียญที่สุกงอมแล้วเป็นของทีมงาน ริบไม่ได้
      </p>
      <label className="text-ink-secondary mt-2 block text-sm">
        เหตุผลริบเหรียญ
        <select
          aria-label="เหตุผลริบเหรียญ"
          value={reason}
          onChange={(e) => setReason(e.target.value as ConfiscationReason)}
          className={FIELD_STACKED}
        >
          {CONFISCATION_REASONS.map((rs) => (
            <option key={rs} value={rs}>
              {CONFISCATION_REASON_LABEL[rs]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-ink-secondary mt-2 block text-sm">
        หมายเหตุ (ถ้ามี)
        <input
          type="text"
          aria-label="หมายเหตุ"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <div className="mt-3">
        <ConfirmActionButton
          idleLabel="ริบเหรียญ"
          pendingLabel="กำลังริบ…"
          confirmMessage="ริบเหรียญที่ยังไม่สุกงอมทั้งหมดของทีมงานคนนี้? เหรียญที่สุกงอมแล้วจะไม่ถูกริบ"
          confirmLabel="ยืนยันริบ"
          buttonClassName={DANGER_BTN}
          action={() => confiscateCoinsAction(workerId, reason, note)}
        />
      </div>
    </div>
  );
}

export function NovaWorkerActions({
  workerId,
  shopItems,
}: {
  workerId: string;
  shopItems: ShopItem[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <SaverBonusButton workerId={workerId} />
      <RedeemForm workerId={workerId} items={shopItems} />
      <ConfiscateForm workerId={workerId} />
    </div>
  );
}
