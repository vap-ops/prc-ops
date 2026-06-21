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
  GMAP_URL_MAX,
  PROJECT_TYPES,
  PROJECT_TYPE_LABEL,
  validateProjectName,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/projects/validate-settings";
import { NOTES_MAX } from "@/lib/notes/validate";
import { useToast } from "@/lib/ui/use-toast";
import {
  updateProjectSettings,
  createClient,
  addProjectMember,
  removeProjectMember,
} from "./actions";

const STATUS_ORDER: ReadonlyArray<ProjectStatus> = ["active", "on_hold", "completed", "archived"];

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";

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
  initialGmapUrl: string | null;
  contractReference: string | null;
  initialStartDate: string | null;
  initialPlannedCompletionDate: string | null;
  initialClientId: string | null;
  initialProjectLeadId: string | null;
  initialProjectType: ProjectType | null;
  initialBudget: number | null;
  clients: ClientOption[];
  staff: StaffOption[];
  members: StaffOption[];
}

export function SettingsForm(props: SettingsFormProps) {
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [name, setName] = useState(props.initialName);
  const [status, setStatus] = useState<ProjectStatus>(props.initialStatus);
  const [notes, setNotes] = useState(props.initialNotes ?? "");
  const [siteAddress, setSiteAddress] = useState(props.initialSiteAddress ?? "");
  const [gmapUrl, setGmapUrl] = useState(props.initialGmapUrl ?? "");
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

  // Spec 80: team members. Add/remove persist immediately (own actions) and
  // update local state — no router.refresh, so the form's unsaved edits survive.
  const [members, setMembers] = useState<StaffOption[]>(props.members);
  const [memberToAdd, setMemberToAdd] = useState("");
  const [memberPending, startMember] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const nameCheck = validateProjectName(name);
  const canSubmit = nameCheck.ok && !submitting;

  function handleAddMember() {
    const id = memberToAdd;
    if (!id) return;
    setError(null);
    startMember(async () => {
      const result = await addProjectMember(props.projectId, id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const entry = props.staff.find((s) => s.id === id);
      setMembers((prev) => [...prev, { id, name: entry?.name ?? null }]);
      setMemberToAdd("");
      toast.success("เพิ่มสมาชิกแล้ว");
    });
  }

  function handleRemoveMember(id: string) {
    setError(null);
    startMember(async () => {
      const result = await removeProjectMember(props.projectId, id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMembers((prev) => prev.filter((m) => m.id !== id));
      toast.success("ลบสมาชิกแล้ว");
    });
  }

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
        gmapUrl,
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

  const busy = submitting || addPending || memberPending;
  const addableStaff = props.staff.filter((s) => !members.some((m) => m.id === s.id));

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-card border-edge bg-card shadow-card flex flex-col gap-4 border p-5"
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
          className="border-edge-strong bg-card text-ink h-11"
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
          className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
          placeholder="ที่อยู่หรือพิกัดหน้างาน"
        />
      </div>

      {/* Spec 174: paste the Google-Maps "Share" link → the project's ⓘ sheet opens
          the exact pin. https + a Google host is enforced server-side. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-gmap-url" className={LABEL}>
          ลิงก์ Google Maps
        </label>
        <Input
          id="project-gmap-url"
          type="url"
          inputMode="url"
          value={gmapUrl}
          maxLength={GMAP_URL_MAX}
          onChange={(e) => setGmapUrl(e.target.value)}
          disabled={busy}
          className="border-edge-strong bg-card text-ink h-11"
          placeholder="วางลิงก์จากแอป Google Maps (ปุ่มแชร์)"
        />
        <p className="text-ink-muted text-xs">
          เปิดหมุดตำแหน่งหน้างานแบบแม่นยำ — วางลิงก์ที่ได้จากปุ่มแชร์ใน Google Maps
        </p>
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
          className="border-edge-strong bg-page text-ink-muted h-11"
        />
        <p className="text-ink-muted text-xs">แก้ไขไม่ได้ (ตั้งครั้งเดียวตอนนำเข้าข้อมูล)</p>
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
        <span className={LABEL}>ทีมงาน</span>
        {members.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {members.map((m) => (
              <li
                key={m.id}
                className="rounded-control border-edge bg-page flex items-center justify-between gap-2 border px-3 py-2"
              >
                <span className="text-ink truncate text-sm">{m.name ?? m.id.slice(0, 8)}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveMember(m.id)}
                  disabled={busy}
                  aria-label={`ลบ ${m.name ?? "สมาชิก"}`}
                  className="text-danger shrink-0 px-2 text-sm font-medium"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted text-xs">ยังไม่มีสมาชิกในทีม</p>
        )}
        {addableStaff.length > 0 && (
          <div className="flex gap-2">
            <select
              aria-label="เลือกสมาชิกเพิ่ม"
              value={memberToAdd}
              onChange={(e) => setMemberToAdd(e.target.value)}
              disabled={busy}
              className={FIELD}
            >
              <option value="">— เลือกสมาชิก —</option>
              {addableStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? s.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddMember}
              disabled={busy || memberToAdd === ""}
              className={BUTTON_PRIMARY}
            >
              เพิ่ม
            </button>
          </div>
        )}
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
          className="border-edge-strong bg-card text-ink h-11"
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
            className="text-action self-start text-sm font-medium underline-offset-2 hover:underline"
          >
            + เพิ่มลูกค้าใหม่
          </button>
        )}
      </div>

      {addingOpen && (
        <div className="rounded-control border-edge bg-page flex flex-col gap-2 border p-4">
          <p className={LABEL}>เพิ่มลูกค้าใหม่</p>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={addPending}
            placeholder="ชื่อลูกค้า (จำเป็น)"
            className="border-edge-strong bg-card text-ink h-11"
          />
          <Input
            value={newContact}
            onChange={(e) => setNewContact(e.target.value)}
            disabled={addPending}
            placeholder="ผู้ติดต่อ"
            className="border-edge-strong bg-card text-ink h-11"
          />
          <Input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            disabled={addPending}
            placeholder="เบอร์โทร"
            className="border-edge-strong bg-card text-ink h-11"
          />
          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={addPending}
            placeholder="อีเมล"
            className="border-edge-strong bg-card text-ink h-11"
          />
          <Input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            disabled={addPending}
            placeholder="ที่อยู่สำหรับเอกสาร"
            className="border-edge-strong bg-card text-ink h-11"
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
              className="text-ink-secondary h-11 px-4 text-sm font-medium"
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
          className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
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
