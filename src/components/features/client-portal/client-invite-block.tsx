"use client";

// Spec 233 / ADR 0067 — PD/super affordance on the project page to issue a
// temporary, read-only client portal login. Pick a valid-until date → generate
// a single-use, 14-day LINE claim link (create_client_invite via the action) →
// copy/send it. Below: the active client bindings, each with a revoke button.
// Mirrors src/components/features/portal/contractor-invite-block.tsx.
//
// 'use client': date input, the generated-link state + clipboard copy, and the
// revoke transitions.

import { useState, useTransition } from "react";
import {
  createClientInvite,
  revokeClientAccess,
  updateClientAccessTier,
} from "@/app/projects/[projectId]/actions";
import { buildClientClaimUrl } from "@/lib/client-portal/claim-url";
import { useToast } from "@/lib/ui/use-toast";
import type { ClientAccessTier } from "@/lib/db/enums";
import {
  CARD,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  FIELD_INPUT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

const TIER_LABEL: Record<ClientAccessTier, string> = {
  basic: "พื้นฐาน",
  full: "เต็มรูปแบบ",
};

export interface ClientBindingView {
  id: string;
  name: string;
  /** ISO timestamp (access valid-until), or null. */
  expiresAt: string | null;
  tier: ClientAccessTier;
}

export function ClientInviteBlock({
  projectId,
  bindings,
}: {
  projectId: string;
  bindings: ReadonlyArray<ClientBindingView>;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [validUntil, setValidUntil] = useState("");
  const [tier, setTier] = useState<ClientAccessTier>("basic");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
    if (!validUntil) {
      setError("กรุณาเลือกวันหมดอายุ");
      return;
    }
    startTransition(async () => {
      const result = await createClientInvite({ projectId, validUntil, tier });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUrl(buildClientClaimUrl(window.location.origin, result.token));
    });
  }

  function changeTier(accessId: string, newTier: ClientAccessTier) {
    startTransition(async () => {
      const result = await updateClientAccessTier({ accessId, projectId, tier: newTier });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("เปลี่ยนระดับสิทธิ์แล้ว");
      // The action revalidates the project page → the bindings list refreshes.
    });
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

  function revoke(accessId: string) {
    startTransition(async () => {
      const result = await revokeClientAccess({ accessId, projectId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("เพิกถอนสิทธิ์แล้ว");
      // The action revalidates the project page → the bindings list refreshes.
    });
  }

  return (
    <section className={`${CARD} mb-4`}>
      <p className="text-ink text-sm font-semibold">เข้าถึงสำหรับลูกค้า</p>
      <p className="text-ink-muted mt-0.5 text-xs">
        สร้างลิงก์ให้ลูกค้าติดตามความคืบหน้าโครงการแบบอ่านอย่างเดียว (เข้าด้วย LINE ·
        ลิงก์ใช้ได้ครั้งเดียว · หมดอายุใน 14 วัน)
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor="client-valid-until" className="text-ink-secondary text-xs">
          ให้สิทธิ์เข้าถึงได้ถึงวันที่
        </label>
        <input
          id="client-valid-until"
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          className={FIELD_INPUT}
        />
        <fieldset className="flex items-center gap-4">
          <legend className="text-ink-secondary text-xs">ระดับสิทธิ์</legend>
          {(Object.keys(TIER_LABEL) as ClientAccessTier[]).map((t) => (
            <label key={t} className="text-ink flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="client-tier"
                value={t}
                checked={tier === t}
                onChange={() => setTier(t)}
              />
              {TIER_LABEL[t]}
            </label>
          ))}
        </fieldset>
        {url ? (
          <>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className={FIELD_INPUT}
            />
            <button type="button" onClick={() => void copy()} className={BUTTON_PRIMARY}>
              คัดลอกลิงก์
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={generate}
            className={BUTTON_SECONDARY_MUTED}
          >
            {pending ? "กำลังสร้าง…" : "สร้างลิงก์เชิญลูกค้า"}
          </button>
        )}
        {error ? (
          <p role="alert" className={INLINE_ALERT_TEXT}>
            {error}
          </p>
        ) : null}
      </div>

      {bindings.length > 0 ? (
        <ul className="border-edge mt-4 flex flex-col gap-2 border-t pt-3">
          {bindings.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink min-w-0 truncate">
                {b.name}
                {b.expiresAt ? (
                  <span className="text-ink-muted"> · ถึง {b.expiresAt.slice(0, 10)}</span>
                ) : null}
              </span>
              <select
                aria-label={`ระดับสิทธิ์ของ ${b.name}`}
                disabled={pending}
                value={b.tier}
                onChange={(e) => changeTier(b.id, e.target.value as ClientAccessTier)}
                className="border-edge shrink-0 rounded-md border bg-transparent px-1.5 py-0.5 text-xs"
              >
                {(Object.keys(TIER_LABEL) as ClientAccessTier[]).map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABEL[t]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={() => revoke(b.id)}
                className="text-danger shrink-0 text-xs font-medium underline"
              >
                เพิกถอน
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
