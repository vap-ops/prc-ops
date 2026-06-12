"use client";

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
import { updateProjectSettings } from "./actions";

const STATUS_ORDER: ReadonlyArray<ProjectStatus> = ["active", "on_hold", "completed", "archived"];

interface SettingsFormProps {
  projectId: string;
  initialName: string;
  initialStatus: ProjectStatus;
}

export function SettingsForm({ projectId, initialName, initialStatus }: SettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<ProjectStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, startSubmit] = useTransition();

  const nameCheck = validateProjectName(name);
  const canSubmit = nameCheck.ok && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nameCheck.ok) return;
    setError(null);
    setSaved(false);
    startSubmit(async () => {
      const result = await updateProjectSettings({ projectId, name, status });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
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
            setSaved(false);
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
            setSaved(false);
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

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          {error}
        </div>
      )}
      {saved && !error && (
        <p role="status" className="text-xs font-medium text-emerald-700">
          บันทึกแล้ว
        </p>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {submitting ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
        </button>
      </div>
    </form>
  );
}
