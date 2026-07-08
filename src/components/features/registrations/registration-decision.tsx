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
import { approveStaffRegistration, rejectStaffRegistration } from "@/app/registrations/actions";
import type { UserRole } from "@/lib/auth/role-home";
import {
  USER_ROLE_LABEL,
  REGISTRATION_SITE_ASSIGN_LABEL,
  REGISTRATION_SITE_ASSIGN_HINT,
  REGISTRATION_SITE_ASSIGN_EMPTY_OPTION,
} from "@/lib/i18n/labels";
import { validateRejectReason } from "@/lib/register/reject-reason";
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

// The self-onboard entry (/register/technician) yields only field roles, so the
// approver picks between just ช่าง and ผู้ดูแลไซต์ — not the full staff-onboard list
// (operator directive, 2026-07-08). Default = ช่าง (technician), the common case.
const QR_ROLE_OPTIONS: readonly UserRole[] = ["technician", "site_admin"];
const DEFAULT_ROLE: UserRole = "technician";

export function RegistrationDecision({
  registrationId,
  declaredRoleHint,
  projects = [],
}: {
  registrationId: string;
  declaredRoleHint?: string | null;
  /** Active projects the approver may assign as the site. Optional (harmless
   *  default []) — the selector still renders with just the empty option. */
  projects?: ReadonlyArray<RegistrationProjectOption>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<UserRole>(DEFAULT_ROLE);
  const [projectId, setProjectId] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveStaffRegistration({
        registrationId,
        role,
        projectId: projectId || null,
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

  const hint = declaredRoleHint?.trim();

  return (
    <div className="flex flex-col gap-3">
      {!showReject ? (
        <>
          {/* Role: only the two self-onboard field roles — ช่าง (default) or ผู้ดูแลไซต์. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="approve-role" className="text-ink text-sm font-medium">
              มอบหมายบทบาท
            </label>
            <select
              id="approve-role"
              value={role}
              disabled={pending}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={FIELD_STACKED}
            >
              {QR_ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            {hint ? <p className="text-ink-muted text-xs">ผู้สมัครระบุว่า: {hint}</p> : null}
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
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={approve} className={BUTTON_PRIMARY}>
              อนุมัติ
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowReject(true)}
              className={BUTTON_SECONDARY}
            >
              ปฏิเสธ
            </button>
          </div>
        </>
      ) : (
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
      )}
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
