"use client";

// Spec 392 U2a — add or rename a zone from the LIST, which is the keyboard and
// screen-reader path to everything U2b's canvas will do. 'use client'
// justified: controlled inputs, sheet open state, submit pending, inline error,
// router.refresh to surface the change. The saveZone action and the DEFINER
// upsert_project_zone beneath it are the load-bearing validators.
// Mirrors AddCategorySheet (spec 207 U3).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ZONE_LABEL } from "@/lib/i18n/labels";
import {
  ZONE_CODE_MAX,
  ZONE_NAME_MAX,
  validateZoneCode,
  validateZoneName,
} from "@/lib/zones/validate-zone";
import { saveZone } from "./actions";

const LABEL = "text-sm font-medium text-ink";

export interface ZoneSheetProps {
  projectId: string;
  mapId: string;
  /** Present = rename an existing zone; absent = add a new one. */
  zone?: { id: string; code: string; name: string };
  trigger: React.ReactNode;
}

export function ZoneSheet({ projectId, mapId, zone, trigger }: ZoneSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(zone?.code ?? "");
  const [name, setName] = useState(zone?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const isEdit = zone !== undefined;
  const title = isEdit ? `แก้ไข${ZONE_LABEL}` : `เพิ่ม${ZONE_LABEL}`;
  const canSubmit = validateZoneCode(code).ok && validateZoneName(name).ok && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await saveZone({
        projectId,
        mapId,
        ...(zone ? { zoneId: zone.id } : {}),
        code,
        name,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!isEdit) {
        setCode("");
        setName("");
      }
      setOpen(false);
      // The list on the page behind gains (or renames) the row, so the sheet
      // closing is not a bare dismissal — the outcome is visible where the user
      // is looking. (The silent-success rule, #791.)
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        {trigger}
      </button>

      <BottomSheet open={open} title={title} onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="zone-code" className={LABEL}>
              รหัสโซน
            </label>
            <Input
              id="zone-code"
              value={code}
              maxLength={ZONE_CODE_MAX}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 font-mono"
              placeholder="เช่น A"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="zone-name" className={LABEL}>
              ชื่อโซน
            </label>
            <Input
              id="zone-name"
              value={name}
              maxLength={ZONE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11"
              placeholder="เช่น พื้นลานด้านซ้าย"
            />
          </div>

          {error ? <p className={INLINE_ERROR}>{error}</p> : null}

          <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
            {submitting ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </form>
      </BottomSheet>
    </>
  );
}
