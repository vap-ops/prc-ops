"use client";

// Spec 207 U3 — the "add หมวดงาน" (project work-category) sheet on the project
// page. 'use client' justified: controlled inputs, sheet open state, submit
// pending, inline error, router.refresh to surface the new category. The
// createProjectCategory server action (and the SECURITY DEFINER
// create_project_category RPC beneath it) are the load-bearing validators.
// Mirrors AddDeliverableSheet (spec 164 U1).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import {
  CATEGORY_CODE_MAX,
  CATEGORY_NAME_MAX,
  validateCategoryCode,
  validateCategoryName,
} from "@/lib/categories/validate";
import { createProjectCategory } from "./actions";

const LABEL = "text-sm font-medium text-ink";

export function AddCategorySheet({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit = validateCategoryCode(code).ok && validateCategoryName(name).ok && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createProjectCategory({ projectId, code, name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode("");
      setName("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        + เพิ่มหมวดงาน
      </button>

      <BottomSheet open={open} title="เพิ่มหมวดงาน" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-category-code" className={LABEL}>
              รหัสหมวด
            </label>
            <Input
              id="new-category-code"
              value={code}
              maxLength={CATEGORY_CODE_MAX}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 font-mono"
              placeholder="เช่น STRUCT"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-category-name" className={LABEL}>
              ชื่อหมวด
            </label>
            <Input
              id="new-category-name"
              value={name}
              maxLength={CATEGORY_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11"
              placeholder="เช่น งานโครงสร้าง"
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังเพิ่ม…" : "สร้างหมวดงาน"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
