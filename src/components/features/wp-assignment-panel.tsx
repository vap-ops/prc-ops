"use client";

import { BUTTON_PRIMARY, FIELD_INPUT, FIELD_SELECT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

// 'use client' justification (spec 31): contractor select + inline
// create form + pending state around the assignment actions. Rendered
// only for PM/super (the page gates); RLS re-enforces server-side.
// Replaced the spec-28 user-owner/team panel (ADR 0033).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createContractor,
  setWorkPackageContractor,
} from "@/app/sa/projects/[projectId]/work-packages/[workPackageId]/assignment-actions";

export interface ContractorOption {
  id: string;
  name: string;
  phone: string | null;
}

interface WpAssignmentPanelProps {
  projectId: string;
  workPackageId: string;
  contractors: ContractorOption[];
  contractorId: string | null;
}

export function WpAssignmentPanel({
  projectId,
  workPackageId,
  contractors,
  contractorId,
}: WpAssignmentPanelProps) {
  const router = useRouter();
  const [nameDraft, setNameDraft] = useState<string>("");
  const [phoneDraft, setPhoneDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function assign(id: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await setWorkPackageContractor({
        projectId,
        workPackageId,
        contractorId: id,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleCreateAndAssign() {
    setError(null);
    startTransition(async () => {
      const created = await createContractor({ name: nameDraft, phone: phoneDraft });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      const assigned = await setWorkPackageContractor({
        projectId,
        workPackageId,
        contractorId: created.id,
      });
      if (!assigned.ok) {
        setError(assigned.error);
        return;
      }
      setNameDraft("");
      setPhoneDraft("");
      router.refresh();
    });
  }

  return (
    <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
        มอบหมายงาน
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label htmlFor="wp-contractor" className="text-xs font-medium text-zinc-900">
          ผู้รับเหมา
        </label>
        <select
          id="wp-contractor"
          value={contractorId ?? ""}
          onChange={(e) => assign(e.target.value === "" ? null : e.target.value)}
          disabled={pending}
          className={FIELD_SELECT}
        >
          <option value="">— ไม่ระบุ —</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.phone ? ` · ${c.phone}` : ""}
            </option>
          ))}
        </select>

        <details>
          <summary className="cursor-pointer text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
            เพิ่มผู้รับเหมาใหม่
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="text"
              value={nameDraft}
              maxLength={200}
              onChange={(e) => setNameDraft(e.target.value)}
              disabled={pending}
              placeholder="ชื่อผู้รับเหมา"
              className={FIELD_INPUT}
            />
            <input
              type="tel"
              value={phoneDraft}
              maxLength={50}
              onChange={(e) => setPhoneDraft(e.target.value)}
              disabled={pending}
              placeholder="เบอร์โทร (ไม่บังคับ)"
              className={FIELD_INPUT}
            />
            <button
              type="button"
              onClick={handleCreateAndAssign}
              disabled={pending || nameDraft.trim().length === 0}
              className={BUTTON_PRIMARY}
            >
              {pending ? "กำลังบันทึก…" : "สร้างและมอบหมาย"}
            </button>
          </div>
        </details>

        {error ? (
          <p role="alert" className={INLINE_ALERT_TEXT}>
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
