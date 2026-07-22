"use client";

// Spec 263 U3 / spec 264 G4 — the back-office approve/reject control on a
// registration's review detail. Approve now carries a ROLE SELECTOR: the approver
// picks which role the applicant becomes (options = STAFF_ONBOARDABLE_ROLES,
// labels from USER_ROLE_LABEL), defaulting to `technician` (the common case + the
// current open entry link). The picked role is passed as p_role to
// approve_staff_registration; the RPC's floor asserts full_name + id_card +
// consent and re-guards the role against the DB allowlist (a denial surfaces as
// the Thai-mapped error). The applicant's optional declared_role_hint is shown
// beside the selector as advisory routing context (never a gate — ADR 0072 §3).
//
// Reject requires a non-blank reason (spec doc: reject_staff_registration takes
// p_reason; the reason textarea only appears once "ปฏิเสธ" is tapped, mirroring a
// confirm step rather than a silent one-tap reject — the action is not reversible:
// no re-application, spec 263 "out of scope").
//
// Site-assignment follow-up: an OPTIONAL project/site selector sits beside the
// role selector (default empty = unassigned). Shown unconditionally regardless
// of the picked role — simpler UX than gating on role, and harmless: the RPC
// only acts on p_project_id for a FIELD role (workers.project_id insert); for an
// office role the value is accepted but ignored. The selector still defaults to
// empty even though the role selector defaults to technician (the field-role
// case) — the operator said "NOT forced", so no site is ever pre-selected.
//
// 'use client' justified: the role-select state, project-select state, pending
// state, the local reject-reason input, and the server-action calls all need
// client interactivity.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveStaffRegistration,
  rejectStaffRegistration,
  sendBackStaffRegistration,
} from "@/app/registrations/actions";
import { type UserRole } from "@/lib/auth/role-home";
import {
  USER_ROLE_LABEL,
  REGISTRATION_SITE_ASSIGN_LABEL,
  REGISTRATION_SITE_ASSIGN_HINT,
  REGISTRATION_SITE_ASSIGN_EMPTY_OPTION,
} from "@/lib/i18n/labels";
import { validateRejectReason } from "@/lib/register/reject-reason";
import { FIELD_ROLE_OPTIONS, OFFICE_ROLE_OPTIONS } from "@/lib/register/office-roles";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

export interface RegistrationProjectOption {
  id: string;
  code: string;
  name: string;
}

// Spec 333 U2a — the selector is the documented SSOT (STAFF_ONBOARDABLE_ROLES),
// grouped หน้างาน (field) / ออฟฟิศ. This supersedes the 2026-07-08 two-role
// narrowing (technician + site_admin), which pre-dated any real office
// applicant and made `legal` unassignable from the UI (operator directive
// 2026-07-21: the legal-dept hires are approved through this queue).
// Default = ช่าง (technician), the common case.
// Field/office role options now live in @/lib/register/office-roles (spec 342 U1.2).
const DEFAULT_ROLE: UserRole = "technician";

// Spec 333 U2b — the ส่งเอกสารภายหลัง helper copy (single surface — this sheet).
const DEFER_DOCS_HINT =
  "อนุมัติได้โดยยังไม่มีบัตรประชาชน/สมุดบัญชี ผู้สมัครส่งเอกสารเพิ่มภายหลัง (ใช้ไม่ได้กับตำแหน่งช่าง)";

export interface RegistrationContractorOption {
  id: string;
  name: string;
}

export function RegistrationDecision({
  registrationId,
  declaredRoleHint,
  projects = [],
  invitedProjectId = null,
  contractors = [],
  invitedContractorId = null,
}: {
  registrationId: string;
  declaredRoleHint?: string | null;
  /** Active projects the approver may assign as the site. Optional (harmless
   *  default []) — the selector still renders with just the empty option. */
  projects?: ReadonlyArray<RegistrationProjectOption>;
  /** Spec 279 F2b — the project the applicant's QR was for; pre-selects the site
   *  so the approver can one-tap approve. Advisory + VISITOR-SUPPLIED: honored ONLY
   *  when it matches one of the approver's RLS-scoped active `projects` options.
   *  A cross-project / non-active / forged id falls back to empty (unassigned) so
   *  the visible selection and the submitted p_project_id never diverge — an
   *  unverified ref must never silently drive the binding. */
  invitedProjectId?: string | null;
  /** Spec 328 U3 — active firms the approver may bind the applicant to. */
  contractors?: ReadonlyArray<RegistrationContractorOption>;
  /** Spec 328 U3 — the firm whose QR invited this applicant. Same trust rule as
   *  invitedProjectId: advisory pre-select ONLY, honored when it matches one of
   *  the approver's RLS-scoped `contractors` options; else falls back to empty
   *  (= ทีม PRC, full bank floor applies at the RPC). */
  invitedContractorId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<UserRole>(DEFAULT_ROLE);
  // Pre-select the invited project ONLY if it's a selectable option (see prop
  // docs) — a controlled <select> whose value matches no <option> renders blank
  // yet keeps the value in state, which would submit a hidden, unconfirmed id.
  const [projectId, setProjectId] = useState(
    invitedProjectId && projects.some((p) => p.id === invitedProjectId) ? invitedProjectId : "",
  );
  // Spec 328 U3 — same trust-rule pre-select for the firm.
  const [contractorId, setContractorId] = useState(
    invitedContractorId && contractors.some((c) => c.id === invitedContractorId)
      ? invitedContractorId
      : "",
  );
  // Spec 333 U2b — ส่งเอกสารภายหลัง: visible only for a non-technician role with
  // no firm picked; cleared whenever either transition hides it so a later
  // re-pick never resurfaces a stale tick. The RPC is the sole gate.
  const [deferDocs, setDeferDocs] = useState(false);
  const deferVisible = role !== "technician" && contractorId === "";
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  // Spec 322 — the non-terminal "send back for edit" flow (parallel to reject).
  const [showSendBack, setShowSendBack] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveStaffRegistration({
        registrationId,
        role,
        projectId: projectId || null,
        contractorId: contractorId || null,
        deferDocuments: deferVisible && deferDocs,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("อนุมัติแล้ว");
      router.refresh();
    });
  }

  function submitReject() {
    const reasonError = validateRejectReason(reason);
    if (reasonError) {
      setError(reasonError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await rejectStaffRegistration({ registrationId, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ปฏิเสธแล้ว");
      router.refresh();
    });
  }

  // Spec 322 — send back for edit: a REQUIRED note (what to fix), validated with
  // the same non-blank contract as the reject reason. Keeps the row pending.
  function submitSendBack() {
    const noteError = validateRejectReason(note);
    if (noteError) {
      setError(noteError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await sendBackStaffRegistration({ registrationId, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ส่งกลับให้แก้ไขแล้ว");
      router.refresh();
    });
  }

  const hint = declaredRoleHint?.trim();

  return (
    <div className="flex flex-col gap-3">
      {!showReject && !showSendBack ? (
        <>
          {/* Role: the STAFF_ONBOARDABLE_ROLES SSOT, grouped field/office
              (spec 333 U2a). Default stays ช่าง. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="approve-role" className="text-ink text-sm font-medium">
              มอบหมายบทบาท
            </label>
            <select
              id="approve-role"
              value={role}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value as UserRole;
                setRole(next);
                // Spec 333 U2b — returning to the field role hides the defer
                // checkbox; clear it so a later office re-pick starts unticked.
                if (next === "technician") setDeferDocs(false);
              }}
              className={FIELD_STACKED}
            >
              {/* Spec 328 U3 — a firm member is ALWAYS a technician (the RPC's
                  contractor arm refuses any other role); disable the rest while
                  a firm is picked so the UI can't hit that error. */}
              <optgroup label="หน้างาน">
                {FIELD_ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r} disabled={contractorId !== "" && r !== "technician"}>
                    {USER_ROLE_LABEL[r]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="ออฟฟิศ">
                {OFFICE_ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r} disabled={contractorId !== ""}>
                    {USER_ROLE_LABEL[r]}
                  </option>
                ))}
              </optgroup>
            </select>
            {hint ? <p className="text-ink-muted text-xs">ผู้สมัครระบุว่า: {hint}</p> : null}
          </div>
          {/* Spec 333 U2b — deferred documents (office roles only; the RPC is
              the authoritative gate, mig 075822). */}
          {deferVisible ? (
            <div className="flex flex-col gap-1">
              <label className="text-ink flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={deferDocs}
                  disabled={pending}
                  onChange={(e) => setDeferDocs(e.target.checked)}
                  className="size-4"
                />
                ส่งเอกสารภายหลัง
              </label>
              <p className="text-ink-muted text-xs">{DEFER_DOCS_HINT}</p>
            </div>
          ) : null}
          {/* Spec 328 U3 — the firm the applicant joins (ทีมผู้รับเหมา). Empty =
              ทีม PRC (regular hire, full bank floor). Picking a firm forces the
              role to technician and makes the approval bank-exempt (RPC arm). */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="approve-contractor" className="text-ink text-sm font-medium">
              ทีมผู้รับเหมา
            </label>
            <select
              id="approve-contractor"
              value={contractorId}
              disabled={pending}
              onChange={(e) => {
                setContractorId(e.target.value);
                // Spec 333 U2b — the contractor arm is never deferred; picking
                // a firm forces technician and clears any stale tick.
                if (e.target.value !== "") {
                  setRole("technician");
                  setDeferDocs(false);
                }
              }}
              className={FIELD_STACKED}
            >
              <option value="">— ทีม PRC (ไม่สังกัดผู้รับเหมา) —</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-ink-muted text-xs">
              สมาชิกทีมผู้รับเหมาจะเป็นช่างเสมอ และไม่ต้องมีบัญชีธนาคาร
              (ผู้รับเหมาเป็นผู้จ่ายค่าแรง)
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="approve-project" className="text-ink text-sm font-medium">
              {REGISTRATION_SITE_ASSIGN_LABEL}
            </label>
            <select
              id="approve-project"
              value={projectId}
              disabled={pending}
              onChange={(e) => setProjectId(e.target.value)}
              className={FIELD_STACKED}
            >
              <option value="">{REGISTRATION_SITE_ASSIGN_EMPTY_OPTION}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-ink-muted text-xs">{REGISTRATION_SITE_ASSIGN_HINT}</p>
          </div>
          <button type="button" disabled={pending} onClick={approve} className={BUTTON_PRIMARY}>
            อนุมัติ
          </button>
          {/* Spec 322 — non-approve alternatives: ส่งกลับให้แก้ไข (primary, non-terminal)
              then ปฏิเสธ (terminal deny). Both open a confirm-step note/reason panel. */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setShowSendBack(true);
                setError(null);
              }}
              className={BUTTON_SECONDARY}
            >
              ส่งกลับให้แก้ไข
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setShowReject(true);
                setError(null);
              }}
              className={BUTTON_SECONDARY}
            >
              ปฏิเสธ
            </button>
          </div>
        </>
      ) : null}
      {showSendBack ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="send-back-note" className="text-ink text-sm font-medium">
            สิ่งที่ต้องแก้ไข
          </label>
          <textarea
            id="send-back-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className={FIELD_STACKED}
            placeholder="ระบุสิ่งที่ต้องแก้ไข เช่น เอกสารไม่ครบ / รูปกลับด้านให้ตรง"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={submitSendBack}
              className={BUTTON_PRIMARY}
            >
              ยืนยันส่งกลับ
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setShowSendBack(false);
                setError(null);
              }}
              className={BUTTON_SECONDARY}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : null}
      {showReject ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="reject-reason" className="text-ink text-sm font-medium">
            เหตุผลที่ปฏิเสธ
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className={FIELD_STACKED}
            placeholder="ระบุเหตุผล เช่น เอกสารไม่ครบ"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={submitReject}
              className={BUTTON_PRIMARY}
            >
              ยืนยันปฏิเสธ
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setShowReject(false);
                setError(null);
              }}
              className={BUTTON_SECONDARY}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
