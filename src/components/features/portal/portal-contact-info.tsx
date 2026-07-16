"use client";

// Spec 132 U1 — DC self-edits their own contactability on /portal (phone, email,
// contact person, mailing address). Direct apply via update_own_contractor_profile
// (column-scoped to these four fields; name/status/tax_id stay out of reach).
// 'use client': form + pending state.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOwnContactInfo } from "@/lib/portal/actions";
import { validateContractorProfile } from "@/lib/portal/contractor-profile";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function PortalContactInfo({
  initial,
  bare = false,
  onSaved,
}: {
  initial: { phone: string; email: string; contactPerson: string; mailingAddress: string };
  // Spec 321 U3b — hosted inside a BottomSheet (edit-in-modal, decision 6): drop
  // the card chrome and close the sheet on save.
  bare?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [contactPerson, setContactPerson] = useState(initial.contactPerson);
  const [mailingAddress, setMailingAddress] = useState(initial.mailingAddress);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const v = validateContractorProfile({ phone, email, contactPerson, mailingAddress });
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = await updateOwnContactInfo({ phone, email, contactPerson, mailingAddress });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกแล้ว");
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className={bare ? "" : CARD}>
      <label className="text-ink-secondary block text-sm">
        ผู้ติดต่อ
        <input
          value={contactPerson}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setContactPerson(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เบอร์โทร
        <input
          value={phone}
          maxLength={30}
          inputMode="tel"
          disabled={pending}
          onChange={(e) => {
            setPhone(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        อีเมล
        <input
          value={email}
          maxLength={200}
          inputMode="email"
          disabled={pending}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ที่อยู่
        <textarea
          value={mailingAddress}
          maxLength={500}
          rows={2}
          disabled={pending}
          onChange={(e) => {
            setMailingAddress(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
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
