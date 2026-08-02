"use client";

// Spec 389 U4 — the PD mapping list. One row per legacy WP: current mapping or
// the bridge suggestion pre-selected; ยืนยัน / เลือกเอง (or เปลี่ยน) / ล้าง per
// row. Writes via the mapWpToCatalog server action (DEFINER RPC underneath).
//
// Review-hardened (2026-08-03): mapped rows keep a re-pick affordance (the
// RPC's star-MOVE arm is only reachable through a DIRECT re-map — clear-then-
// map would destroy the stars instead); ล้าง is 2-tap confirmed because it
// hard-deletes the WP's reference stars; the picker submits from an explicit
// ยืนยัน button, never from the select's onChange.

import { useMemo, useState, useTransition } from "react";
import { mapWpToCatalog } from "@/app/projects/[projectId]/catalog-mapping/actions";
import { BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY_COMPACT, CARD } from "@/lib/ui/classes";

export interface MappingRowData {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
  currentItemId: string | null;
  suggestionItemId: string | null;
  suggestionBasis: "old_id" | "name" | null;
}

export interface MappingItemOption {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
}

const BASIS_LABEL: Record<"old_id" | "name", string> = {
  old_id: "จากรหัสเดิม",
  name: "ชื่อตรงกัน",
};

function MappingRow({
  projectId,
  row,
  items,
  itemById,
}: {
  projectId: string;
  row: MappingRowData;
  items: MappingItemOption[];
  itemById: Map<string, MappingItemOption>;
}) {
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<string>("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = row.currentItemId ? itemById.get(row.currentItemId) : null;
  const suggestion = row.suggestionItemId ? itemById.get(row.suggestionItemId) : null;

  const submit = (itemId: string | null) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await mapWpToCatalog(projectId, row.id, itemId);
      if (!res.ok) {
        setError(res.error ?? "บันทึกการจับคู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }
      setPicking(false);
      setConfirmClear(false);
      setPick("");
      if (res.starsRetired && res.starsRetired > 0) {
        setNotice(`ลบดาวรูปตัวอย่างของงานนี้ ${res.starsRetired} รายการ`);
      } else if (res.starsMoved && res.starsMoved > 0) {
        setNotice(`ย้ายดาวรูปตัวอย่างตามไป ${res.starsMoved} รายการ`);
      }
    });
  };

  const options = items.filter((i) => i.isGroup === row.isGroup);

  return (
    <li className={`${CARD} flex flex-col gap-2 p-3`}>
      <div className="flex items-baseline gap-2">
        <span className="text-ink-secondary shrink-0 font-mono text-xs">{row.code}</span>
        <span className="text-body text-ink min-w-0 font-medium">{row.name}</span>
        {row.isGroup ? (
          <span className="rounded-control bg-sunk text-ink-secondary shrink-0 px-1.5 py-0.5 text-xs">
            งานหลัก
          </span>
        ) : null}
      </div>

      {picking ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`เลือกงานมาตรฐานสำหรับ ${row.code}`}
            className="rounded-control border-edge bg-card text-body text-ink min-h-11 min-w-0 flex-1 border px-2"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={pending}
          >
            <option value="">— เลือกงานมาตรฐาน —</option>
            {options.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} · {i.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || pick === "" || pick === row.currentItemId}
            onClick={() => submit(pick)}
            className={BUTTON_PRIMARY_COMPACT}
          >
            ยืนยันตัวเลือก
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPicking(false);
              setPick("");
            }}
            className={BUTTON_SECONDARY_COMPACT}
          >
            ยกเลิก
          </button>
        </div>
      ) : current ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body text-ink-secondary min-w-0">
            จับคู่แล้ว: <span className="font-mono text-xs">{current.code}</span> {current.name}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPick(row.currentItemId ?? "");
              setPicking(true);
            }}
            className={BUTTON_SECONDARY_COMPACT}
          >
            เปลี่ยน
          </button>
          {confirmClear ? (
            <>
              <span className="text-body text-danger-ink">
                ล้างการจับคู่? ดาวรูปตัวอย่างของงานนี้จะถูกลบด้วย
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => submit(null)}
                className={BUTTON_PRIMARY_COMPACT}
              >
                ยืนยันการล้าง
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmClear(false)}
                className={BUTTON_SECONDARY_COMPACT}
              >
                ยกเลิก
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmClear(true)}
              className={BUTTON_SECONDARY_COMPACT}
            >
              ล้างการจับคู่
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {suggestion && row.suggestionBasis ? (
            <>
              <span className="text-body text-ink min-w-0">
                แนะนำ: <span className="font-mono text-xs">{suggestion.code}</span>{" "}
                {suggestion.name}{" "}
                <span className="text-ink-secondary text-xs">
                  ({BASIS_LABEL[row.suggestionBasis]})
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => submit(suggestion.id)}
                className={BUTTON_PRIMARY_COMPACT}
              >
                ยืนยัน
              </button>
            </>
          ) : (
            <span className="text-body text-ink-secondary">ไม่มีคำแนะนำ</span>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setPicking(true)}
            className={BUTTON_SECONDARY_COMPACT}
          >
            เลือกเอง
          </button>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-body text-danger-ink">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-body text-ink-secondary">
          {notice}
        </p>
      ) : null}
    </li>
  );
}

export function MappingList({
  projectId,
  rows,
  items,
}: {
  projectId: string;
  rows: MappingRowData[];
  items: MappingItemOption[];
}) {
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const unmapped = rows.filter((r) => !r.currentItemId);
  const mapped = rows.filter((r) => r.currentItemId);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-body text-ink-secondary mb-2 font-medium">
          ยังไม่จับคู่ ({unmapped.length})
        </h2>
        {unmapped.length === 0 ? (
          <p className="text-body text-ink-secondary">ไม่มี WP ที่ยังไม่จับคู่</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {unmapped.map((r) => (
              <MappingRow
                key={r.id}
                projectId={projectId}
                row={r}
                items={items}
                itemById={itemById}
              />
            ))}
          </ul>
        )}
      </section>

      {mapped.length > 0 ? (
        <section>
          <h2 className="text-body text-ink-secondary mb-2 font-medium">
            จับคู่แล้ว ({mapped.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {mapped.map((r) => (
              <MappingRow
                key={r.id}
                projectId={projectId}
                row={r}
                items={items}
                itemById={itemById}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
