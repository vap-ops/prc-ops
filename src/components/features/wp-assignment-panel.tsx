"use client";

// 'use client' justification (spec 28 Part A): two selects + pending
// state around the three assignment actions. Rendered only for PM/super
// (the page gates); RLS re-enforces server-side.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addWorkPackageMember,
  removeWorkPackageMember,
  setWorkPackageOwner,
} from "@/app/sa/projects/[projectId]/work-packages/[workPackageId]/assignment-actions";
import type { StaffOption } from "@/lib/users/display-names";

interface WpAssignmentPanelProps {
  projectId: string;
  workPackageId: string;
  staff: StaffOption[];
  ownerId: string | null;
  memberIds: string[];
}

export function WpAssignmentPanel({
  projectId,
  workPackageId,
  staff,
  ownerId,
  memberIds,
}: WpAssignmentPanelProps) {
  const router = useRouter();
  const [memberDraft, setMemberDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));

  function run(action: () => Promise<{ ok: boolean } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError("error" in result ? result.error : "ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }
      router.refresh();
    });
  }

  return (
    <details className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
        มอบหมายงาน
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label htmlFor="wp-owner" className="text-xs font-medium text-zinc-900">
          ผู้รับผิดชอบ
        </label>
        <select
          id="wp-owner"
          value={ownerId ?? ""}
          onChange={(e) =>
            run(() =>
              setWorkPackageOwner({
                projectId,
                workPackageId,
                ownerId: e.target.value === "" ? null : e.target.value,
              }),
            )
          }
          disabled={pending}
          className="h-11 w-full min-w-0 rounded-md border border-zinc-400 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        >
          <option value="">— ไม่ระบุ —</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <label htmlFor="wp-member-add" className="text-xs font-medium text-zinc-900">
          เพิ่มสมาชิกทีม
        </label>
        <div className="flex gap-2">
          <select
            id="wp-member-add"
            value={memberDraft}
            onChange={(e) => setMemberDraft(e.target.value)}
            disabled={pending}
            className="h-11 w-full min-w-0 rounded-md border border-zinc-400 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <option value="">เลือกสมาชิก</option>
            {staff
              .filter((s) => !memberIds.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={pending || memberDraft === ""}
            onClick={() => {
              const userId = memberDraft;
              setMemberDraft("");
              run(() => addWorkPackageMember({ projectId, workPackageId, userId }));
            }}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-zinc-400 bg-white px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            เพิ่ม
          </button>
        </div>

        {memberIds.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {memberIds.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate text-zinc-900">{nameOf.get(id) ?? id}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => removeWorkPackageMember({ projectId, workPackageId, userId: id }))
                  }
                  className="shrink-0 font-medium text-red-700 hover:underline disabled:opacity-60"
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
