"use client";

// Spec 170 U4b-2 / ADR 0062 — a DC worker gives/withdraws PDPA + background-check
// consent on /portal. Records via record_worker_consent (self-scoped to the bound
// worker); withdrawal via revoke_contractor_consent (now admits the bound worker).
// Mirrors the contractor ConsentCard. 'use client': per-action pending state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordOwnWorkerConsent, revokeOwnConsent } from "@/lib/portal/actions";
import type { PortalConsent } from "@/components/features/portal/portal-self-edit";
import { useToast } from "@/lib/ui/use-toast";
import { formatThaiDate } from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, CARD, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

type ConsentKind = "pdpa_data" | "background_check";
const KIND_LABEL: Record<ConsentKind, string> = {
  pdpa_data: "ยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล (PDPA)",
  background_check: "ยินยอมให้ตรวจสอบประวัติ",
};
const KINDS: ConsentKind[] = ["pdpa_data", "background_check"];

export function WorkerConsents({ consents }: { consents: PortalConsent[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = (kind: ConsentKind) =>
    consents.find((c) => c.kind === kind && c.revoked_at === null);

  function give(kind: ConsentKind) {
    setError(null);
    startTransition(async () => {
      const result = await recordOwnWorkerConsent({ kind });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกความยินยอมแล้ว");
      router.refresh();
    });
  }

  function withdraw(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeOwnConsent({ id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ยกเลิกความยินยอมแล้ว");
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <p className="text-ink-muted text-xs">
        เพื่อประมวลผลการจ้างงานและการจ่ายเงิน บริษัทจำเป็นต้องเก็บข้อมูลและเอกสารของท่าน
        โปรดให้ความยินยอมด้านล่าง
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {KINDS.map((kind) => {
          const cur = active(kind);
          return (
            <li key={kind} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink text-sm font-medium">{KIND_LABEL[kind]}</p>
                {cur ? (
                  <p className="text-done-strong text-xs">
                    ยินยอมแล้ว · {formatThaiDate(cur.consented_at)}
                  </p>
                ) : null}
              </div>
              {cur ? (
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-done-strong text-sm font-medium">✓</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => withdraw(cur.id)}
                    className="text-ink-muted text-xs underline"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => give(kind)}
                  className={BUTTON_PRIMARY}
                >
                  ยินยอม
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className={`mt-2 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
