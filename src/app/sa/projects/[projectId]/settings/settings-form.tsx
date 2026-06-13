"use client";

import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";

// Project settings form (spec 58 + 79). 'use client' justified: controlled
// inputs, inline client-add, submit pending state, inline error/success.
// The server action (and the RPCs beneath it) are the load-bearing validators.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import {
  PROJECT_NAME_MAX,
  SITE_ADDRESS_MAX,
  PROJECT_TYPES,
  PROJECT_TYPE_LABEL,
  validateProjectName,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/projects/validate-settings";
import { NOTES_MAX } from "@/lib/notes/validate";
import { useToast } from "@/lib/ui/use-toast";
import { updateProjectSettings, createClient } from "./actions";

const STATUS_ORDER: ReadonlyArray<ProjectStatus> = ["active", "on_hold", "completed", "archived"];

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-2 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";
const LABEL = "text-sm font-medium text-zinc-900";

interface ClientOption {
  id: string;
  name: string;
}
interface StaffOption {
  id: string;
  name: string | null;
}

interface SettingsFormProps {
  projectId: string;
  initialName: string;
  initialStatus: ProjectStatus;
  initialNotes: string | null;
  initialSiteAddress: string | null;
  contractReference: string | null;
  initialStartDate: string | null;
  initialPlannedCompletionDate: string | null;
  initialClientId: string | null;
  initialProjectLeadId: string | null;
  initialProjectType: ProjectType | null;
  initialBudget: number | null;
  clients: ClientOption[];
  staff: StaffOption[];
}

export function SettingsForm(props: SettingsFormProps) {
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [name, setName] = useState(props.initialName);
  const [status, setStatus] = useState<ProjectStatus>(props.initialStatus);
  const [notes, setNotes] = useState(props.initialNotes ?? "");
  const [siteAddress, setSiteAddress] = useState(props.initialSiteAddress ?? "");
  const [startDate, setStartDate] = useState(props.initialStartDate ?? "");
  const [completionDate, setCompletionDate] = useState(props.initialPlannedCompletionDate ?? "");
  const [projectType, setProjectType] = useState<string>(props.initialProjectType ?? "");
  const [projectLeadId, setProjectLeadId] = useState(props.initialProjectLeadId ?? "");
  const [budget, setBudget] = useState(
    props.initialBudget != null ? String(props.initialBudget) : "",
  );

  const [clients, setClients] = useState<ClientOption[]>(props.clients);
  const [clientId, setClientId] = useState(props.initialClientId ?? "");

  // Inline "add client".
  const [addingOpen, setAddingOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addPending, startAdd] = useTransition();
  const [addError, setAddError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const nameCheck = validateProjectName(name);
  const canSubmit = nameCheck.ok && !submitting;

  function handleAddClient() {
    if (newName.trim().length === 0) return;
    setAddError(null);
    startAdd(async () => {
      const result = await createClient({
        name: newName,
        contactPerson: newContact,
        phone: newPhone,
        email: newEmail,
        mailingAddress: newAddress,
      });
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      const added = { id: result.id, name: newName.trim() };
      setClients((prev) => [...prev, added].sort((a, b) => a.name.localeCompare(b.name, "th")));
      setClientId(result.id);
      setNewName("");
      setNewContact("");
      setNewPhone("");
      setNewEmail("");
      setNewAddress("");
      setAddingOpen(false);
      toast.success("เพิ่มลูกค้าแล้ว");
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!nameCheck.ok) return;
    setError(null);
    startSubmit(async () => {
      const result = await updateProjectSettings({
        projectId: props.projectId,
        name,
        status,
        notes,
        siteAddress,
        startDate,
        plannedCompletionDate: completionDate,
        projectType,
        projectLeadId,
        budgetAmount: budget,
        clientId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  }

  const busy = submitting || addPending;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name" className={LABEL}>
          ชื่อโครงการ
        </label>
        <Input
          id="project-name"
          value={name}
          maxLength={PROJECT_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="h-11 border-zinc-400 bg-white text-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-status" className={LABEL}>
          สถานะโครงการ
        </label>
        <select
          id="project-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ProjectStatus)}
          disabled={busy}
          className={FIELD}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-site-address" className={LABEL}>
          ที่ตั้งโครงการ
        </label>
        <textarea
          id="project-site-address"
          value={siteAddress}
          maxLength={SITE_ADDRESS_MAX}
          rows={2}
          onChange={(e) => setSiteAddress(e.target.value)}
          disabled={busy}
          className="w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          placeholder="ที่อยู่หรือพิกัดหน้างาน"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-contract-ref" className={LABEL}>
          หมายเลขสัญญาจ้าง
        </label>
        <Input
          id="project-contract-ref"
          value={props.contractReference ?? "—"}
          readOnly
          disabled
          className="h-11 border-zinc-300 bg-zinc-50 text-zinc-500"
        />
        <p className="text-xs text-zinc-500">แก้ไขไม่ได้ (ตั้งครั้งเดียวตอนนำเข้าข้อมูล)</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="project-start" className={LABEL}>
            วันเริ่มโครงการ
          </label>
          <input
            id="project-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={busy}
            className={FIELD}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="project-completion" className={LABEL}>
            วันเสร็จตามแผน
          </label>
          <input
            id="project-completion"
            type="date"
            value={completionDate}
            min={today}
            onChange={(e) => setCompletionDate(e.target.value)}
            disabled={busy}
            className={FIELD}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-type" className={LABEL}>
          ประเภทโครงการ
        </label>
        <select
          id="project-type"
          value={projectType}
          onChange={(e) => setProjectType(e.target.value)}
          disabled={busy}
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
        <label htmlFor="project-lead" className={LABEL}>
          ผู้รับผิดชอบโครงการ
        </label>
        <select
          id="project-lead"
          value={projectLeadId}
          onChange={(e) => setProjectLeadId(e.target.value)}
          disabled={busy}
          className={FIELD}
        >
          <option value="">— ไม่ระบุ —</option>
          {props.staff.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-budget" className={LABEL}>
          งบประมาณ (บาท)
        </label>
        <Input
          id="project-budget"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          disabled={busy}
          className="h-11 border-zinc-400 bg-white text-zinc-900"
          placeholder="เช่น 1500000"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-client" className={LABEL}>
          ลูกค้า / เจ้าของโครงการ
        </label>
        <select
          id="project-client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={busy}
          className={FIELD}
        >
          <option value="">— ไม่ระบุ —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!addingOpen && (
          <button
            type="button"
            onClick={() => setAddingOpen(true)}
            disabled={busy}
            className="self-start text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            + เพิ่มลูกค้าใหม่
          </button>
        )}
      </div>

      {addingOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <p className={LABEL}>เพิ่มลูกค้าใหม่</p>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={addPending}
            placeholder="ชื่อลูกค้า (จำเป็น)"
            className="h-11 border-zinc-400 bg-white text-zinc-900"
          />
          <Input
            value={newContact}
            onChange={(e) => setNewContact(e.target.value)}
            disabled={addPending}
            placeholder="ผู้ติดต่อ"
            className="h-11 border-zinc-400 bg-white text-zinc-900"
          />
          <Input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            disabled={addPending}
            placeholder="เบอร์โทร"
            className="h-11 border-zinc-400 bg-white text-zinc-900"
          />
          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={addPending}
            placeholder="อีเมล"
            className="h-11 border-zinc-400 bg-white text-zinc-900"
          />
          <Input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            disabled={addPending}
            placeholder="ที่อยู่สำหรับเอกสาร"
            className="h-11 border-zinc-400 bg-white text-zinc-900"
          />
          {addError && (
            <div role="alert" className={INLINE_ERROR}>
              {addError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAddingOpen(false);
                setAddError(null);
              }}
              disabled={addPending}
              className="h-11 px-4 text-sm font-medium text-zinc-600"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleAddClient}
              disabled={addPending || newName.trim().length === 0}
              className={BUTTON_PRIMARY}
            >
              {addPending ? "กำลังเพิ่ม…" : "เพิ่มลูกค้า"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-notes" className={LABEL}>
          หมายเหตุ
        </label>
        <textarea
          id="project-notes"
          value={notes}
          maxLength={NOTES_MAX}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
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
