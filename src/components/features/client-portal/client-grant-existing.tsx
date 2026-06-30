"use client";

// Spec 234 / ADR 0067 U3 (+ broken-link follow-up) — PD/super affordance on the
// project page to grant a client (read-only viewer) login to THIS project
// WITHOUT the claim link. Pick a logged-in user (a `visitor` who is flipped to
// client, or an existing client) + a valid-until → grant_client_access (mig
// 039000) via the action. Always renders for an issuer (discoverability); with
// no eligible users it shows a hint instead of the picker. Mirrors
// client-invite-block.tsx.

import { useState, useTransition } from "react";
import { grantClientAccess } from "@/app/projects/[projectId]/actions";
import { useToast } from "@/lib/ui/use-toast";
import { CARD, BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export interface ClientCandidate {
  id: string;
  name: string;
}

const FIELD = "border-edge-strong rounded-control text-ink bg-card w-full border px-3 py-2 text-xs";

export function ClientGrantExisting({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: ReadonlyArray<ClientCandidate>;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  function grant() {
    setError(null);
    if (!userId) {
      setError("เลือกลูกค้าก่อน");
      return;
    }
    if (!validUntil) {
      setError("กรุณาเลือกวันหมดอายุ");
      return;
    }
    startTransition(async () => {
      const result = await grantClientAccess({ userId, projectId, validUntil });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ให้สิทธิ์เข้าถึงแล้ว");
      setUserId("");
      setValidUntil("");
    });
  }

  return (
    <section className={`${CARD} mb-4`}>
      <p className="text-ink text-sm font-semibold">เพิ่มลูกค้าให้ดูโครงการ</p>
      <p className="text-ink-muted mt-0.5 text-xs">
        เลือกผู้ใช้ที่เข้าสู่ระบบแล้ว ให้เป็นลูกค้าดูความคืบหน้าโครงการนี้ (อ่านอย่างเดียว)
      </p>

      {candidates.length === 0 ? (
        <p className="text-ink-secondary mt-3 text-xs">
          ยังไม่มีผู้ใช้ที่เข้าสู่ระบบ — ให้ลูกค้าเข้าสู่ระบบด้วย LINE และตั้งชื่อก่อน
          แล้วจึงเลือกที่นี่
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor="grant-existing-client" className="text-ink-secondary text-xs">
            เลือกผู้ใช้
          </label>
          <select
            id="grant-existing-client"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={FIELD}
          >
            <option value="">เลือกผู้ใช้…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label htmlFor="grant-existing-valid-until" className="text-ink-secondary text-xs">
            ให้สิทธิ์เข้าถึงได้ถึงวันที่
          </label>
          <input
            id="grant-existing-valid-until"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className={FIELD}
          />

          <button
            type="button"
            disabled={pending}
            onClick={grant}
            className={BUTTON_SECONDARY_MUTED}
          >
            {pending ? "กำลังให้สิทธิ์…" : "ให้สิทธิ์เข้าถึง"}
          </button>
          {error ? (
            <p role="alert" className={INLINE_ALERT_TEXT}>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
