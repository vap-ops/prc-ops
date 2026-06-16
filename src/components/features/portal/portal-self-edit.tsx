"use client";

// Spec 131 U2b — DC self-service on /portal: edit own emergency contact + DOB,
// and give PDPA / background-check consent. Both go through RLS-scoped RPCs
// (update_own_emergency_contact column-scopes to the four fields; consent is
// self-validated). 'use client': form + per-action pending state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOwnEmergencyContact, recordOwnConsent } from "@/lib/portal/actions";
import { validateEmergencyContact } from "@/lib/portal/emergency-contact";
import { useToast } from "@/lib/ui/use-toast";
import { formatThaiDate } from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

type ConsentKind = "pdpa_data" | "background_check";
const KIND_LABEL: Record<ConsentKind, string> = {
  pdpa_data: "ยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล (PDPA)",
  background_check: "ยินยอมให้ตรวจสอบประวัติ",
};
const KINDS: ConsentKind[] = ["pdpa_data", "background_check"];

export interface PortalConsent {
  kind: ConsentKind;
  consented_at: string;
  revoked_at: string | null;
}

export function PortalSelfEdit({
  contractorId,
  ec,
  consents,
}: {
  contractorId: string;
  ec: { name: string; relation: string; phone: string; dob: string };
  consents: PortalConsent[];
}) {
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <h2 className="text-ink-secondary mt-6 mb-2 text-sm font-semibold">ผู้ติดต่อฉุกเฉิน</h2>
      <EmergencyForm contractorId={contractorId} ec={ec} router={router} toast={toast} />

      <h2 className="text-ink-secondary mt-6 mb-2 text-sm font-semibold">ความยินยอม</h2>
      <ConsentCard contractorId={contractorId} consents={consents} router={router} toast={toast} />
    </>
  );
}

type RouterT = ReturnType<typeof useRouter>;
type ToastT = ReturnType<typeof useToast>;

function EmergencyForm({
  contractorId: _contractorId,
  ec,
  router,
  toast,
}: {
  contractorId: string;
  ec: { name: string; relation: string; phone: string; dob: string };
  router: RouterT;
  toast: ToastT;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(ec.name);
  const [relation, setRelation] = useState(ec.relation);
  const [phone, setPhone] = useState(ec.phone);
  const [dob, setDob] = useState(ec.dob);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const v = validateEmergencyContact({ name, relation, phone });
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = await updateOwnEmergencyContact({ name, relation, phone, dob });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <label className="text-ink-secondary block text-sm">
        ชื่อผู้ติดต่อฉุกเฉิน
        <input
          value={name}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ความสัมพันธ์
        <input
          value={relation}
          maxLength={60}
          disabled={pending}
          onChange={(e) => setRelation(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เบอร์โทรฉุกเฉิน
        <input
          value={phone}
          maxLength={30}
          inputMode="tel"
          disabled={pending}
          onChange={(e) => setPhone(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        วันเกิด
        <input
          type="date"
          value={dob}
          disabled={pending}
          onChange={(e) => setDob(e.target.value)}
          className={`${FIELD_STACKED} appearance-none`}
        />
      </label>
      {error ? (
        <p role="alert" className={`mt-3 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className={`mt-4 w-full ${BUTTON_PRIMARY}`}
      >
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
    </div>
  );
}

function ConsentCard({
  contractorId,
  consents,
  router,
  toast,
}: {
  contractorId: string;
  consents: PortalConsent[];
  router: RouterT;
  toast: ToastT;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = (kind: ConsentKind) =>
    consents.find((c) => c.kind === kind && c.revoked_at === null);

  function give(kind: ConsentKind) {
    setError(null);
    startTransition(async () => {
      const result = await recordOwnConsent({ contractorId, kind });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกความยินยอมแล้ว");
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
                <span className="text-done-strong shrink-0 text-sm font-medium">✓</span>
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
