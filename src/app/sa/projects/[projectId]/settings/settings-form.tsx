"use client";

import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";

// Project settings form (spec 58). 'use client' justified: controlled
// inputs + submit pending state + inline error/success surfaces. The
// server action (and beneath it the RPC) is the load-bearing validator.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import {
  PROJECT_NAME_MAX,
  validateProjectName,
  type ProjectStatus,
} from "@/lib/projects/validate-settings";
import { NOTES_MAX } from "@/lib/notes/validate";
import { useToast } from "@/lib/ui/use-toast";
import { updateProjectSettings } from "./actions";

const STATUS_ORDER: ReadonlyArray<ProjectStatus> = ["active", "on_hold", "completed", "archived"];

interface SettingsFormProps {
  projectId: string;
  initialName: string;
  initialStatus: ProjectStatus;
  initialNotes: string | null;
}

export function SettingsForm({
  projectId,
  initialName,
  initialStatus,
  initialNotes,
}: SettingsFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<ProjectStatus>(initialStatus);
  // Spec 72: editable backup note, batched into this form's single save.
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const nameCheck = validateProjectName(name);
  const canSubmit = nameCheck.ok && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nameCheck.ok) return;
    setError(null);
    startSubmit(async () => {
      const result = await updateProjectSettings({ projectId, name, status, notes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Spec 76: success → transient toast (survives the refresh).
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name" className="text-sm font-medium text-zinc-900">
          ชื่อโครงการ
        </label>
        <Input
          id="project-name"
          value={name}
          maxLength={PROJECT_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
          }}
          disabled={submitting}
          className="h-11 border-zinc-400 bg-white text-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-status" className="text-sm font-medium text-zinc-900">
          สถานะโครงการ
        </label>
        <select
          id="project-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ProjectStatus);
          }}
          disabled={submitting}
          className="h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-2 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-notes" className="text-sm font-medium text-zinc-900">
          หมายเหตุ
        </label>
        <textarea
          id="project-notes"
          value={notes}
          maxLength={NOTES_MAX}
          rows={3}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
          disabled={submitting}
          className="w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          placeholder="ข้อมูลเพิ่มเติมเกี่ยวกับโครงการที่ไม่มีช่องให้กรอกโดยตรง"
        />
      </div>

      {error && (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
        </button>
      </div>
    </form>
  );
}
