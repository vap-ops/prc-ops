// Spec 264 follow-up (Handoff Unit A) — the applicant waiting-card. Operator:
// real-user testing showed a newcomer on the pending branch of
// /register/technician saw only the e-card + the Web Share button, with no
// explanation — they didn't know they were actually DONE and just waiting.
//
// Spec 343 U1 — that card was ALSO rendering over an application that was not
// actually submitted: the approval floor still wanted an id_card upload and a
// PDPA consent record, and every one of the 4 live pending applicants stopped
// exactly there (two of them for 14 days, after being chased in person). So the
// "submitted, sit tight" copy is now the floor-MET branch only. Below the floor
// the card states the application is incomplete, names each outstanding item,
// and links it to the control that satisfies it.
// Still COPY ONLY — no new state, no new action, no RLS. The floor arrives as a
// prop, derived once server-side by RegistrationWorkspace.

import Link from "next/link";
import { CARD } from "@/lib/ui/classes";
import type { ApprovalFloor, ApprovalRequirement } from "@/lib/register/registration-floor";
import {
  REGISTRATION_PENDING_NOTICE_HEADING,
  REGISTRATION_PENDING_NOTICE_BODY,
  REGISTRATION_INCOMPLETE_NOTICE_HEADING,
  REGISTRATION_ANTI_PHISHING_LINE,
  APPROVAL_REQUIREMENT_LABEL,
  REGISTER_DOCUMENTS_ANCHOR,
  REGISTER_CONSENT_ANCHOR,
  registrationIncompleteBody,
  registrationPendingEmployeeIdLine,
} from "@/lib/i18n/labels";

export interface RegistrationPendingNoticeProps {
  employeeId: string;
  /** Required, never defaulted — a default would let a caller silently render
   *  the "submitted" copy over an incomplete application, which is the exact
   *  defect this unit exists to remove. */
  floor: ApprovalFloor;
}

/** Which control satisfies each requirement. `full_name` and `bank_fields` are
 *  inline fields of the profile form itself with no anchor of their own, so they
 *  render as plain text rather than a link that would jump nowhere. */
const ANCHOR_FOR: Record<ApprovalRequirement, string | null> = {
  full_name: null,
  id_card: REGISTER_DOCUMENTS_ANCHOR,
  book_bank: REGISTER_DOCUMENTS_ANCHOR,
  bank_fields: null,
  consent: REGISTER_CONSENT_ANCHOR,
};

export function RegistrationPendingNotice({ employeeId, floor }: RegistrationPendingNoticeProps) {
  return (
    <div className={`${CARD} border-attn-edge bg-attn-soft`}>
      <p className="text-attn-ink text-sm font-semibold">
        {floor.met ? REGISTRATION_PENDING_NOTICE_HEADING : REGISTRATION_INCOMPLETE_NOTICE_HEADING}
      </p>
      <p className="text-attn-ink mt-1 text-sm">
        {floor.met
          ? REGISTRATION_PENDING_NOTICE_BODY
          : registrationIncompleteBody(floor.missing.length)}
      </p>
      {floor.met ? null : (
        <>
          <ul className="mt-2 flex flex-col gap-1">
            {floor.missing.map((requirement) => {
              const anchor = ANCHOR_FOR[requirement];
              const label = APPROVAL_REQUIREMENT_LABEL[requirement];
              return (
                <li key={requirement} className="text-attn-ink text-sm">
                  {anchor ? (
                    <Link
                      href={`#${anchor}`}
                      className="inline-flex min-h-11 items-center font-semibold underline"
                    >
                      {label}
                    </Link>
                  ) : (
                    <span className="font-semibold">{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-attn-ink mt-2 text-xs">{REGISTRATION_ANTI_PHISHING_LINE}</p>
        </>
      )}
      <p className="text-attn-ink mt-2 text-sm select-all">
        {registrationPendingEmployeeIdLine(employeeId)}
      </p>
    </div>
  );
}
