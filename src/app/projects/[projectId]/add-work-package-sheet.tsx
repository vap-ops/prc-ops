"use client";

// Spec 142 U4 — the "add work package" sheet on the project page. 'use client'
// justified: controlled inputs, sheet open state, submit pending, inline error,
// router.refresh to surface the new WP in the list. The createWorkPackage server
// action (and the SECURITY DEFINER create_work_package RPC beneath it) are the
// load-bearing validators.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { WP_GROUP_LABEL, WP_LEAF_LABEL } from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import {
  WP_CODE_MAX,
  WP_NAME_MAX,
  validateWorkPackageCode,
  validateWorkPackageName,
} from "@/lib/work-packages/validate-new-wp";
import { createWorkPackage } from "./actions";

const LABEL = "text-sm font-medium text-ink";

// Spec 270 U4 — in a project that adopted งาน grouping, a new WP is a งานย่อย
// and MUST live under a งาน (the U6 DB guard rejects a parentless insert), so
// the sheet requires the pick. Legacy projects pass no groups → old form.
export interface ParentGroupOption {
  id: string;
  code: string;
  name: string;
}

// Spec 335 — opened from the งาน detail the parent is already known, so the
// select is replaced by static context, the code starts at the parent's prefix
// (all 331 live children follow it) and the wording speaks งานย่อย throughout.
export function AddWorkPackageSheet({
  projectId,
  groups = [],
  fixedParent,
}: {
  projectId: string;
  groups?: ReadonlyArray<ParentGroupOption>;
  fixedParent?: ParentGroupOption;
}) {
  const router = useRouter();
  const initialCode = fixedParent ? `${fixedParent.code}-` : "";
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const needsParent = fixedParent === undefined && groups.length > 0;
  const canSubmit =
    validateWorkPackageCode(code).ok &&
    validateWorkPackageName(name).ok &&
    (!needsParent || parentId !== "") &&
    // The prefill is a head start, not a code: `WP-05-` passes the non-empty
    // validator, so without this the guard that used to hold an untouched code
    // field disabled would be gone in fixedParent mode.
    code.trim() !== initialCode &&
    !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createWorkPackage({
        projectId,
        code,
        name,
        description,
        // Legacy projects keep the exact old payload (key omitted).
        ...(fixedParent ? { parentId: fixedParent.id } : needsParent ? { parentId } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode(initialCode);
      setName("");
      setDescription("");
      setParentId("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        {fixedParent ? `+ เพิ่ม${WP_LEAF_LABEL}` : "+ เพิ่มงาน"}
      </button>

      <BottomSheet
        open={open}
        title={fixedParent ? `เพิ่ม${WP_LEAF_LABEL}` : "เพิ่มรายการงาน"}
        onClose={() => setOpen(false)}
      >
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          {...(fixedParent ? { "aria-describedby": "new-wp-fixed-parent" } : {})}
        >
          {fixedParent ? (
            <p id="new-wp-fixed-parent" className="text-meta text-ink-secondary">
              {`อยู่ใน${WP_GROUP_LABEL} ${fixedParent.code} ${fixedParent.name}`}
            </p>
          ) : null}
          {needsParent ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-wp-parent" className={LABEL}>
                อยู่ในงาน (งานหลัก)
              </label>
              <select
                id="new-wp-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                disabled={submitting}
                className="rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action h-11 w-full min-w-0 border px-3 text-sm focus:outline-none focus-visible:ring-2"
              >
                <option value="">— เลือกงานหลัก —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-wp-code" className={LABEL}>
              รหัสงาน
            </label>
            <Input
              id="new-wp-code"
              value={code}
              maxLength={WP_CODE_MAX}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 font-mono"
              placeholder="เช่น WP-001"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-wp-name" className={LABEL}>
              ชื่องาน
            </label>
            <Input
              id="new-wp-name"
              value={name}
              maxLength={WP_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11"
              placeholder="เช่น งานวางท่อประปา"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-wp-desc" className={LABEL}>
              รายละเอียด (ไม่บังคับ)
            </label>
            <textarea
              id="new-wp-desc"
              value={description}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
              placeholder="ขอบเขตงานโดยย่อ"
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังเพิ่ม…" : fixedParent ? `สร้าง${WP_LEAF_LABEL}` : "สร้างงาน"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
