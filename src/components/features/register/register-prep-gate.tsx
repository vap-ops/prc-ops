"use client";

// Spec 343 U2 — the เตรียมตัว landing shown BEFORE the fresh registration form.
// A first-time applicant used to land straight on the form with no idea it needs
// an ID card and takes ~2 minutes; someone scanning at a site without their card
// hit it cold. This gate states what to bring, then hands off to the SAME form
// on one tap.
//
// It is a STATE, not a route (spec 343 U2). A separate /register/prepare page
// would have to carry ?project&site&by&contractor&firm across another hop and
// re-validate them at each — exactly the bug class #677 fixed, where the login
// round-trip dropped every QR param. So the form is passed in as children,
// already rendered with its params, and this client gate only decides whether to
// show the prep card or reveal it.
//
// 'use client' justification: the single piece of state is `started`, the
// applicant's tap on เริ่มกรอกข้อมูล. Everything the form needs is already
// resolved server-side and passed through as children.

import { useState, type ReactNode } from "react";
import { BUTTON_PRIMARY, CARD } from "@/lib/ui/classes";
import {
  REGISTER_PREP_HEADING,
  REGISTER_PREP_ITEMS_LABEL,
  REGISTER_PREP_ID_CARD_ITEM,
  REGISTER_PREP_BANK_ITEM,
  REGISTER_PREP_TIME_LINE,
  REGISTER_PREP_CONSENT_LINE,
  REGISTER_PREP_START_LABEL,
} from "@/lib/i18n/labels";

export function RegisterPrepGate({
  bankExempt,
  children,
}: {
  /** Spec 328 — a firm member's bank is never collected (the firm is paid per
   *  WP), so the passbook is not something they bring. Mirrors the form's own
   *  bankExempt so the prep list and the form agree. */
  bankExempt: boolean;
  /** The fresh StaffRegistrationForm, already rendered server-side with its QR
   *  params — revealed on the applicant's tap, never re-fetched or re-routed. */
  children: ReactNode;
}) {
  const [started, setStarted] = useState(false);
  if (started) return <>{children}</>;

  return (
    <div className={CARD}>
      <p className="text-ink text-base font-semibold">{REGISTER_PREP_HEADING}</p>
      <p className="text-ink-secondary mt-3 text-sm font-medium">{REGISTER_PREP_ITEMS_LABEL}</p>
      <ul className="mt-1 flex flex-col gap-1">
        <li className="text-ink text-sm">{REGISTER_PREP_ID_CARD_ITEM}</li>
        {bankExempt ? null : <li className="text-ink text-sm">{REGISTER_PREP_BANK_ITEM}</li>}
      </ul>
      <p className="text-ink-muted mt-3 text-sm">{REGISTER_PREP_TIME_LINE}</p>
      <p className="text-ink-muted mt-1 text-sm">{REGISTER_PREP_CONSENT_LINE}</p>
      <button
        type="button"
        onClick={() => setStarted(true)}
        className={`mt-4 w-full ${BUTTON_PRIMARY}`}
      >
        {REGISTER_PREP_START_LABEL}
      </button>
    </div>
  );
}
