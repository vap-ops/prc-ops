"use client";

// Spec 131 U2 — PM consent management on the contractor contact page. Records
// (after collecting the signed form) and revokes (PDPA withdrawal) the two
// consent kinds via the spec-131 RPCs. Money/PII-adjacent — PM-only page.
//
// 'use client' justified: per-kind pending state + the server-action calls.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordContractorConsent, revokeContractorConsent } from "@/app/contacts/actions";
import { useToast } from "@/lib/ui/use-toast";
import { formatThaiDate } from "@/lib/i18n/labels";
import {
  CARD,
  BUTTON_SECONDARY_COMPACT,
  BUTTON_PRIMARY_COMPACT,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

export type ConsentKind = "pdpa_data" | "background_check";

export interface ConsentRow {
  id: string;
  kind: ConsentKind;
  consented_at: string;
  revoked_at: string | null;
}

const KIND_LABEL: Record<ConsentKind, string> = {
  pdpa_data: "ยินยอมเก็บข้อมูล (PDPA)",
  background_check: "ยินยอมตรวจสอบประวัติ",
};

const KINDS: ConsentKind[] = ["pdpa_data", "background_check"];

export function ContactConsentBlock({
  contractorId,
  consents,
}: {
  contractorId: string;
  consents: ConsentRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The current (non-revoked) consent per kind, if any.
  const active = (kind: ConsentKind): ConsentRow | undefined =>
    consents.find((c) => c.kind === kind && c.revoked_at === null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(okMsg);
      router.refresh();
    });
  }

  return (
    <section className={CARD}>
      <p className="text-ink text-sm font-semibold">ความยินยอม (PDPA)</p>
      <p className="text-ink-muted mt-0.5 text-xs">บันทึกเมื่อได้รับเอกสารยินยอมที่ลงนามแล้ว</p>
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
                ) : (
                  <p className="text-ink-muted text-xs">ยังไม่มีความยินยอม</p>
                )}
              </div>
              {cur ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => revokeContractorConsent({ id: cur.id, contractorId }),
                      "เพิกถอนความยินยอมแล้ว",
                    )
                  }
                  className={BUTTON_SECONDARY_COMPACT}
                >
                  เพิกถอน
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => recordContractorConsent({ contractorId, kind }),
                      "บันทึกความยินยอมแล้ว",
                    )
                  }
                  className={BUTTON_PRIMARY_COMPACT}
                >
                  บันทึก
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
    </section>
  );
}
