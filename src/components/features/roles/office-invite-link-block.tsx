"use client";

// Spec 342 U1.3 — the super_admin mint surface on /settings/roles. Pick an
// office role → generate the reusable /register/office?by=&role= link → copy
// for LINE. Pure URL construction (officeInviteUrl), no token and no server
// action: the link is reusable by design (D1) and the role it carries never
// binds (D5 — the approver confirms at approval). The inviter id arrives
// server-supplied from the page (the caller's own ctx.id).
//
// 'use client': select + generated-link state + clipboard copy.

import { useState } from "react";
import { officeInviteUrl } from "@/lib/register/onboard-link";
import { OFFICE_ROLE_OPTIONS } from "@/lib/register/office-roles";
import type { UserRole } from "@/lib/auth/role-home";
import { useToast } from "@/lib/ui/use-toast";
import {
  OFFICE_INVITE_BLOCK_TITLE,
  OFFICE_INVITE_BLOCK_HINT,
  USER_ROLE_LABEL,
} from "@/lib/i18n/labels";
import {
  CARD,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  FIELD_INPUT,
  FIELD_STACKED,
} from "@/lib/ui/classes";

export function OfficeInviteLinkBlock({ inviterId }: { inviterId: string }) {
  const toast = useToast();
  const [role, setRole] = useState<UserRole>(OFFICE_ROLE_OPTIONS[0] ?? "procurement");
  const [url, setUrl] = useState<string | null>(null);

  function generate() {
    setUrl(officeInviteUrl(window.location.origin, { inviterId, role }));
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("คัดลอกลิงก์แล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  return (
    <section className={CARD}>
      <p className="text-ink text-sm font-semibold">{OFFICE_INVITE_BLOCK_TITLE}</p>
      <p className="text-ink-muted mt-0.5 text-xs">{OFFICE_INVITE_BLOCK_HINT}</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ตำแหน่ง
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as UserRole);
            setUrl(null);
          }}
          className={FIELD_STACKED}
        >
          {OFFICE_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {USER_ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      {url ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className={FIELD_INPUT}
          />
          <button type="button" onClick={() => void copy()} className={BUTTON_PRIMARY}>
            คัดลอกลิงก์
          </button>
        </div>
      ) : (
        <button type="button" onClick={generate} className={`mt-3 ${BUTTON_SECONDARY_MUTED}`}>
          สร้างลิงก์เชิญ
        </button>
      )}
    </section>
  );
}
