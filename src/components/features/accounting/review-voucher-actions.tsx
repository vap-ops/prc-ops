"use client";

// Spec 345 U3 — the voucher's action panel: ✅ verify (optional note) and
// 🚩 flag (type + detail), plus per-flag resolve/dismiss rows. Client component
// so action errors render inline (the DB refusals — open flags, reserved type —
// must reach the admin's eyes, not vanish into a silent form post).

import { useState, useTransition } from "react";
import {
  ADMIN_FLAG_TYPES,
  flagTypeLabel,
  type MoneyFlagType,
} from "@/lib/accounting/review-queue-view";
import type { ReviewVoucherFlag } from "@/lib/accounting/load-review-voucher";
import type { ReviewActionResult } from "@/app/accounting/review/[source]/[id]/actions";
import { FIELD_INPUT, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui/classes";

interface Props {
  source: string;
  sourceId: string;
  reviewStatus: "pending" | "flagged" | "verified";
  openFlags: ReviewVoucherFlag[];
  suggestedFlags: ReviewVoucherFlag[];
  verify: (source: string, id: string, note: string) => Promise<ReviewActionResult>;
  flag: (
    source: string,
    id: string,
    flagType: string,
    detail: string,
  ) => Promise<ReviewActionResult>;
  resolve: (
    source: string,
    id: string,
    flagId: string,
    resolution: string,
  ) => Promise<ReviewActionResult>;
  dismiss: (
    source: string,
    id: string,
    flagId: string,
    resolution: string,
  ) => Promise<ReviewActionResult>;
}

export function ReviewVoucherActions({
  source,
  sourceId,
  reviewStatus,
  openFlags,
  suggestedFlags,
  verify,
  flag,
  resolve,
  dismiss,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [flagType, setFlagType] = useState<MoneyFlagType>("missing_doc");
  const [detail, setDetail] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const run = (fn: () => Promise<ReviewActionResult>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="bg-danger-soft text-danger-ink rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {suggestedFlags.length > 0 ? (
        <div className="bg-attn-soft text-attn-ink rounded-md px-3 py-2 text-sm">
          ข้อมูลเงินต้นทางเปลี่ยนหลังตรวจแล้ว — ตรวจซ้ำแล้วกดตรวจผ่านเพื่อล้างธงอัตโนมัติ
        </div>
      ) : null}

      {openFlags.map((f) => (
        <div key={f.id} className="border-border flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm font-medium">
            🚩 {flagTypeLabel(f.flagType as MoneyFlagType)}
            {f.detail ? <span className="text-muted-foreground"> — {f.detail}</span> : null}
          </p>
          <input
            aria-label={`ผลการแก้ไข ${flagTypeLabel(f.flagType as MoneyFlagType)}`}
            className={FIELD_INPUT}
            placeholder="ผลการแก้ไข"
            value={resolutions[f.id] ?? ""}
            onChange={(e) => setResolutions((s) => ({ ...s, [f.id]: e.target.value }))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              className={BUTTON_PRIMARY}
              onClick={() => run(() => resolve(source, sourceId, f.id, resolutions[f.id] ?? ""))}
            >
              แก้ไขแล้ว
            </button>
            <button
              type="button"
              disabled={pending}
              className={BUTTON_SECONDARY}
              onClick={() => run(() => dismiss(source, sourceId, f.id, resolutions[f.id] ?? ""))}
            >
              ปัดตก
            </button>
          </div>
        </div>
      ))}

      <div className="border-border flex flex-col gap-2 rounded-md border p-3">
        <p className="text-sm font-medium">🚩 ติดธง</p>
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">
          ประเภท
          <select
            className={FIELD_INPUT}
            value={flagType}
            onChange={(e) => setFlagType(e.target.value as MoneyFlagType)}
          >
            {ADMIN_FLAG_TYPES.map((t) => (
              <option key={t} value={t}>
                {flagTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <textarea
          aria-label="รายละเอียดธง"
          className={FIELD_INPUT}
          placeholder="รายละเอียด"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
        <button
          type="button"
          disabled={pending}
          className={BUTTON_SECONDARY}
          onClick={() => run(() => flag(source, sourceId, flagType, detail))}
        >
          ติดธง
        </button>
      </div>

      {reviewStatus !== "verified" ? (
        <div className="border-border flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm font-medium">✅ ตรวจผ่าน</p>
          <input
            aria-label="บันทึกการตรวจ"
            className={FIELD_INPUT}
            placeholder="บันทึก (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            disabled={pending || openFlags.length > 0}
            className={BUTTON_PRIMARY}
            onClick={() => run(() => verify(source, sourceId, note))}
          >
            ตรวจผ่าน
          </button>
          {openFlags.length > 0 ? (
            <p className="text-muted-foreground text-xs">ปิดธงให้หมดก่อนจึงจะตรวจผ่านได้</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
