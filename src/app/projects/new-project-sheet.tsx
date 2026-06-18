"use client";

// Spec 142 U2 — the "New project" stub sheet on the project hub. 'use client'
// justified: controlled inputs, sheet open state, submit pending, inline error,
// client-side navigation to the new project. The createProject server action
// (and the SECURITY DEFINER create_project RPC beneath it) are the load-bearing
// validators. Stub captures identity only (code/name/type/client); dates,
// budget, team and work packages are the project page's job (checklist, U3).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import {
  PROJECT_NAME_MAX,
  PROJECT_CODE_MAX,
  PROJECT_TYPES,
  PROJECT_TYPE_LABEL,
  validateProjectCode,
  validateProjectName,
} from "@/lib/projects/validate-settings";
import { projectHref } from "@/lib/nav/project-paths";
import { createProject } from "./actions";

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";

interface ClientOption {
  id: string;
  name: string;
}

export function NewProjectSheet({
  suggestedCode,
  clients,
}: {
  suggestedCode: string;
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(suggestedCode);
  const [name, setName] = useState("");
  const [projectType, setProjectType] = useState("");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const canSubmit = validateProjectName(name).ok && validateProjectCode(code).ok && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createProject({ code, name, projectType, clientId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(projectHref(result.id));
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${BUTTON_PRIMARY} self-start`}
      >
        + เพิ่มโครงการ
      </button>

      <BottomSheet open={open} title="โครงการใหม่" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-project-code" className={LABEL}>
              รหัสโครงการ
            </label>
            <Input
              id="new-project-code"
              value={code}
              maxLength={PROJECT_CODE_MAX}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 font-mono"
            />
            <p className="text-ink-muted text-xs">แนะนำอัตโนมัติ แก้ไขได้</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-project-name" className={LABEL}>
              ชื่อโครงการ
            </label>
            <Input
              id="new-project-name"
              value={name}
              maxLength={PROJECT_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11"
              placeholder="เช่น บ้านคุณสมชาย"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-project-type" className={LABEL}>
              ประเภทโครงการ
            </label>
            <select
              id="new-project-type"
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">— ไม่ระบุ —</option>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROJECT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-project-client" className={LABEL}>
              ลูกค้า / เจ้าของโครงการ
            </label>
            <select
              id="new-project-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">— ไม่ระบุ —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังสร้าง…" : "สร้างโครงการ"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
