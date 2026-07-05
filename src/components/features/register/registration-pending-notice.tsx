// Spec 264 follow-up (Handoff Unit A) — the applicant waiting-card. Operator:
// real-user testing showed a newcomer on the pending branch of
// /register/technician saw only the e-card + the Web Share button, with no
// explanation — they didn't know they were actually DONE and just waiting.
// The back-office queue (/registrations) already lists every pending
// registration; approval never needs the applicant to share anything.
// COPY ONLY: a static render of the same registration data the page already
// has (employeeId) — no new state, no new action, no RLS. Toned like the
// e-card's own "⏳ รออนุมัติ" badge (attn-soft) so it reads as one continuous
// pending story rather than a competing card style.

import { CARD } from "@/lib/ui/classes";
import {
  REGISTRATION_PENDING_NOTICE_HEADING,
  REGISTRATION_PENDING_NOTICE_BODY,
  registrationPendingEmployeeIdLine,
} from "@/lib/i18n/labels";

export interface RegistrationPendingNoticeProps {
  employeeId: string;
}

export function RegistrationPendingNotice({ employeeId }: RegistrationPendingNoticeProps) {
  return (
    <div className={`${CARD} border-attn-edge bg-attn-soft`}>
      <p className="text-attn-ink text-sm font-semibold">{REGISTRATION_PENDING_NOTICE_HEADING}</p>
      <p className="text-attn-ink mt-1 text-sm">{REGISTRATION_PENDING_NOTICE_BODY}</p>
      <p className="text-attn-ink mt-2 text-sm select-all">
        {registrationPendingEmployeeIdLine(employeeId)}
      </p>
    </div>
  );
}
