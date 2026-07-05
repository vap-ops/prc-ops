"use client";

// Spec 270 U2b — the paste → ตรวจสอบ (dry-run) → นำเข้า (apply) flow. 'use client'
// justification: a three-step stateful interaction (paste, inspect the report,
// confirm-apply) on one screen; the report must render without a navigation.

import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/features/common/confirm-dialog";

import {
  applyGroupingImport,
  dryRunGroupingImport,
  type GroupingApplyResult,
  type GroupingDryRun,
} from "./actions";

const PLAN_LABELS: ReadonlyArray<[key: string, label: string]> = [
  ["groupsToCreate", "สร้างงาน (กลุ่ม) ใหม่"],
  ["groupsMatched", "งานเดิมที่จับคู่ได้"],
  ["leavesToCreate", "สร้างงานย่อยใหม่"],
  ["renamed", "เปลี่ยนชื่อ"],
  ["recoded", "เปลี่ยนรหัส"],
  ["parented", "จัดเข้ากลุ่มครั้งแรก"],
  ["reparented", "ย้ายกลุ่ม"],
  ["unchangedNames", "ชื่อเดิมไม่เปลี่ยน"],
];

function planCount(plan: NonNullable<GroupingDryRun["plan"]>, key: string): number {
  const v = plan[key as keyof typeof plan];
  return Array.isArray(v) ? v.length : typeof v === "number" ? v : 0;
}

export function GroupingImportForm({ projectId }: { projectId: string }) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<GroupingDryRun | null>(null);
  const [applied, setApplied] = useState<GroupingApplyResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const canApply = checked !== null && checked.errors.length === 0 && checked.plan !== null;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-ink text-sm font-medium">
          วางข้อมูลจากไฟล์เทมเพลต (คอลัมน์ SubOf, WP, OldCode, ชื่องาน)
        </span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
            setApplied(null);
          }}
          rows={10}
          spellCheck={false}
          className="border-edge bg-card text-ink rounded-xl border p-3 font-mono text-xs"
          placeholder={"SubOf\tWP\tOldCode\tชื่องาน"}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || text.trim() === ""}
          onClick={() =>
            startTransition(async () => {
              setApplied(null);
              setChecked(await dryRunGroupingImport(projectId, text));
            })
          }
          className="bg-ink text-card rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          ตรวจสอบ (dry-run)
        </button>
        <button
          type="button"
          disabled={pending || !canApply}
          onClick={() => setConfirming(true)}
          className="bg-done text-card rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          นำเข้าจริง
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        message={"นำเข้าจริง: เปลี่ยนรหัส ชื่อ และการจัดกลุ่มของทุกงานในโครงการนี้ทั้งชุด"}
        confirmLabel="นำเข้าจริง"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          startTransition(async () => {
            setApplied(await applyGroupingImport(projectId, text));
            setChecked(null);
          });
        }}
      />

      {checked !== null && (
        <section className="flex flex-col gap-3">
          {checked.errors.length > 0 ? (
            <div className="border-danger/40 bg-danger/5 rounded-xl border p-3">
              <p className="text-danger text-sm font-semibold">
                ติดข้อผิดพลาด {checked.errors.length} รายการ — ยังนำเข้าไม่ได้
              </p>
              <ul className="text-danger mt-2 flex flex-col gap-1 text-xs">
                {checked.errors.slice(0, 30).map((e, i) => (
                  <li key={i}>
                    {e.code !== null ? `${e.code}: ` : e.row > 0 ? `บรรทัด ${e.row}: ` : ""}
                    {e.message}
                  </li>
                ))}
                {checked.errors.length > 30 && <li>… อีก {checked.errors.length - 30} รายการ</li>}
              </ul>
            </div>
          ) : (
            <p className="text-done text-sm font-semibold">
              ไฟล์ผ่านการตรวจสอบ ({checked.rowCount} แถว) — พร้อมนำเข้า
            </p>
          )}

          {checked.warnings.length > 0 && (
            <div className="border-attn/40 bg-attn/5 rounded-xl border p-3">
              <p className="text-attn text-sm font-semibold">
                คำเตือน {checked.warnings.length} รายการ
              </p>
              <ul className="text-attn mt-2 flex flex-col gap-1 text-xs">
                {checked.warnings.slice(0, 15).map((w, i) => (
                  <li key={i}>
                    {w.code !== null ? `${w.code}: ` : ""}
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {checked.plan !== null && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PLAN_LABELS.map(([key, label]) => (
                <div key={key} className="border-edge bg-card rounded-xl border p-3">
                  <dt className="text-ink-soft text-xs">{label}</dt>
                  <dd className="text-ink text-lg font-semibold">
                    {planCount(checked.plan as NonNullable<GroupingDryRun["plan"]>, key)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {applied !== null &&
        (applied.ok ? (
          <p className="text-done text-sm font-semibold">
            นำเข้าสำเร็จ — งาน {applied.summary.groups_created ?? 0} กลุ่มใหม่, อัปเดต{" "}
            {applied.summary.existing_updated ?? 0} รายการ
          </p>
        ) : (
          <p className="text-danger text-sm font-semibold">นำเข้าไม่สำเร็จ: {applied.message}</p>
        ))}
    </div>
  );
}
