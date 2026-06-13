"use client";

// Spec 88 — ContactBankBlock: the PM-only bank editor on the contact detail
// page. Money-isolated (spec 85): the page is requireRole(PM_ROLES)-gated, the
// initial values were read by the service-role admin client, and saves go
// through the setContactBank action → set_contact_bank SECURITY DEFINER RPC.
//
// 'use client' justification: a small edit form with a busy state.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setContactBank } from "@/app/contacts/actions";
import type { ContactBank, ContactKind } from "@/lib/contacts/bank";
import { BUTTON_PRIMARY_COMPACT, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";

export function ContactBankBlock({
  kind,
  id,
  initial,
}: {
  kind: ContactKind;
  id: string;
  initial: ContactBank | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [bankAccountNo, setBankAccountNo] = useState(initial?.bankAccountNo ?? "");
  const [bankAccountName, setBankAccountName] = useState(initial?.bankAccountName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await setContactBank({ kind, id, bankName, bankAccountNo, bankAccountName });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("บันทึกแล้ว");
    router.refresh();
  }

  return (
    <section className={CARD}>
      <p className="text-sm font-semibold text-zinc-900">ข้อมูลธนาคาร</p>
      <p className="mt-0.5 text-xs text-zinc-500">เฉพาะผู้จัดการเห็นข้อมูลนี้</p>
      <label className="mt-2 block text-sm text-zinc-700">
        ชื่อธนาคาร
        <input
          value={bankName}
          maxLength={200}
          disabled={busy}
          onChange={(e) => {
            setBankName(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="mt-2 block text-sm text-zinc-700">
        เลขที่บัญชี
        <input
          value={bankAccountNo}
          maxLength={50}
          inputMode="numeric"
          disabled={busy}
          onChange={(e) => setBankAccountNo(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="mt-2 block text-sm text-zinc-700">
        ชื่อบัญชี
        <input
          value={bankAccountName}
          maxLength={200}
          disabled={busy}
          onChange={(e) => setBankAccountName(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      {error ? (
        <p role="alert" className={`mt-2 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
      >
        บันทึกข้อมูลธนาคาร
      </button>
    </section>
  );
}
