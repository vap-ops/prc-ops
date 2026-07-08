"use client";

// Spec 279 U4 — the SA's phoneless "เพิ่มเอง" form: name + Thai national-ID + DOB →
// addProjectWorker (→ sa_add_project_worker). Client checks 13-digit ID + presence;
// the RPC re-validates the checksum + age + firm-wide dedup. 'use client' for the
// controlled inputs + busy/error state + router.refresh after a successful add.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { addProjectWorker } from "@/app/sa/crew/actions";
import { CARD, FIELD_STACKED } from "@/lib/ui/classes";

export function AddWorkerForm({ projects }: { projects: { id: string; code: string }[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [name, setName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nidOk = /^\d{13}$/.test(nationalId);
  const canSubmit = name.trim().length > 0 && nidOk && dob.length > 0 && projectId.length > 0;

  async function submit() {
    setError(null);
    setBusy(true);
    const res = await addProjectWorker({ projectId, name: name.trim(), nationalId, dob });
    setBusy(false);
    if (res.ok) {
      setName("");
      setNationalId("");
      setDob("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <details className={CARD}>
      <summary className="text-ink text-body flex cursor-pointer items-center gap-2 font-semibold">
        <UserPlus aria-hidden className="text-cat-w06 size-5 shrink-0" />
        เพิ่มช่างเอง (ไม่มีมือถือ)
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {projects.length > 1 ? (
          <label className="text-ink-secondary block text-sm">
            โครงการ
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={FIELD_STACKED}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-ink-secondary block text-sm">
          ชื่อ–สกุล
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className={FIELD_STACKED}
          />
        </label>
        <label className="text-ink-secondary block text-sm">
          เลขบัตรประชาชน (13 หลัก)
          <input
            inputMode="numeric"
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value.replace(/\D/g, "").slice(0, 13))}
            aria-label="เลขบัตรประชาชน"
            className={FIELD_STACKED}
          />
        </label>
        <label className="text-ink-secondary block text-sm">
          วันเกิด
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            aria-label="วันเกิด"
            className={FIELD_STACKED}
          />
        </label>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <button
          type="button"
          disabled={busy || !canSubmit}
          onClick={() => void submit()}
          className="bg-fill text-on-fill hover:bg-fill-press inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors active:translate-y-px disabled:opacity-50"
        >
          เพิ่มช่าง
        </button>
        <p className="text-ink-muted text-meta">
          ช่างที่เพิ่มจะขึ้น “รอยืนยัน” จนกว่าผู้จัดการจะยืนยันค่าจ้าง/ระดับ
        </p>
      </div>
    </details>
  );
}
