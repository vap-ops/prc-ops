"use client";

// Spec 310 — company-card registry UI (super_admin). List existing cards + an
// add/edit form. Writes go through the DEFINER RPCs via the server actions; the
// holder becomes the reimburse-target for expenses paid on that card.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deactivateCompanyCard, upsertCompanyCard } from "@/app/settings/cards/actions";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import type { CompanyCard, HolderOption } from "@/lib/expenses/load-office-expenses";
import {
  CARD_ADD_LABEL,
  CARD_CANCEL_LABEL,
  CARD_DEACTIVATE_CONFIRM,
  CARD_DEACTIVATE_LABEL,
  CARD_DEACTIVATE_PENDING,
  CARD_EDIT_LABEL,
  CARD_EMPTY,
  CARD_HOLDER_LABEL,
  CARD_INACTIVE_BADGE,
  CARD_LAST4_LABEL,
  CARD_NAME_LABEL,
  CARD_SAVE_LABEL,
} from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const LABEL = "text-ink flex flex-col gap-1 text-sm font-medium";

export function CardRegistry({
  cards,
  holders,
}: {
  cards: CompanyCard[];
  holders: HolderOption[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [holderUserId, setHolderUserId] = useState("");
  const [last4, setLast4] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resetForm() {
    setEditingId(null);
    setLabel("");
    setHolderUserId("");
    setLast4("");
    setError(null);
  }

  function startEdit(card: CompanyCard) {
    setEditingId(card.id);
    setLabel(card.label);
    setHolderUserId(card.holderUserId);
    setLast4(card.last4 ?? "");
    setError(null);
  }

  function submit() {
    setError(null);
    if (label.trim().length === 0) {
      setError("กรุณาระบุชื่อบัตร");
      return;
    }
    if (holderUserId.length === 0) {
      setError("กรุณาเลือกผู้ถือบัตร");
      return;
    }
    startTransition(async () => {
      const result = await upsertCompanyCard({
        id: editingId,
        label,
        holderUserId,
        last4: last4.trim() === "" ? null : last4.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* existing cards */}
      <ul className="flex flex-col gap-2">
        {cards.length === 0 && <li className="text-ink-secondary text-sm">{CARD_EMPTY}</li>}
        {cards.map((card) => (
          <li
            key={card.id}
            className={`border-edge bg-card flex items-center justify-between gap-3 rounded-xl border p-3 ${
              card.isActive ? "" : "opacity-60"
            }`}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ink truncate text-sm font-medium">
                {card.label}
                {card.last4 ? ` ·${card.last4}` : ""}
                {!card.isActive && (
                  <span className="text-ink-secondary ml-2 text-xs">({CARD_INACTIVE_BADGE})</span>
                )}
              </span>
              <span className="text-ink-secondary truncate text-xs">
                {CARD_HOLDER_LABEL}: {card.holderName ?? "—"}
              </span>
            </div>
            {card.isActive && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(card)}
                  disabled={pending}
                  className="border-edge text-ink rounded-control border px-3 py-1.5 text-xs font-medium"
                >
                  {CARD_EDIT_LABEL}
                </button>
                <ConfirmActionButton
                  idleLabel={CARD_DEACTIVATE_LABEL}
                  pendingLabel={CARD_DEACTIVATE_PENDING}
                  confirmMessage={CARD_DEACTIVATE_CONFIRM}
                  confirmLabel={CARD_DEACTIVATE_LABEL}
                  buttonClassName="border-edge text-ink-secondary rounded-control border px-3 py-1.5 text-xs font-medium"
                  action={() => deactivateCompanyCard(card.id)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* add / edit form */}
      <div className="border-edge bg-card flex flex-col gap-3 rounded-xl border p-4">
        <label className={LABEL}>
          {CARD_NAME_LABEL}
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending}
            placeholder="เช่น PD Visa"
            className={FIELD_INPUT}
          />
        </label>
        <label className={LABEL}>
          {CARD_HOLDER_LABEL}
          <select
            value={holderUserId}
            onChange={(e) => setHolderUserId(e.target.value)}
            disabled={pending}
            className={SELECT}
          >
            <option value="" disabled>
              เลือกผู้ถือบัตร
            </option>
            {holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.fullName ?? h.id}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          {CARD_LAST4_LABEL}
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/[^0-9]/g, ""))}
            disabled={pending}
            className={FIELD_INPUT}
          />
        </label>

        {error && (
          <p role="alert" className={INLINE_ERROR}>
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button type="button" onClick={submit} disabled={pending} className={BUTTON_PRIMARY}>
            {editingId ? CARD_SAVE_LABEL : CARD_ADD_LABEL}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              disabled={pending}
              className="border-edge text-ink rounded-control border px-4 py-2 text-sm font-medium"
            >
              {CARD_CANCEL_LABEL}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
