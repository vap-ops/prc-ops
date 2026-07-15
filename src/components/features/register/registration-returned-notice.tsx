// Spec 322 — the applicant-facing "sent back for edit" card. When an approver
// taps ส่งกลับให้แก้ไข, the registration stays `pending` and the reviewer's note
// lands on `reject_reason`. The workspace renders THIS card in place of the
// generic "sit tight" RegistrationPendingNotice: the applicant must read "action
// needed from you", then fix the listed items in the edit form below (which still
// renders — it is gated only on `pending`) and resubmit. Attention tone (amber),
// NOT danger — this is a request to fix, not a rejection.
//
// COPY ONLY — a static render of data the page already reads (registration
// reject_reason); no new state, action, or RLS.

import { CARD } from "@/lib/ui/classes";
import {
  REGISTRATION_RETURNED_NOTICE_HEADING,
  REGISTRATION_RETURNED_NOTICE_BODY,
} from "@/lib/i18n/labels";

export interface RegistrationReturnedNoticeProps {
  /** The reviewer's note (what to fix), stored on reject_reason while pending. */
  note: string;
}

export function RegistrationReturnedNotice({ note }: RegistrationReturnedNoticeProps) {
  return (
    <div className={`${CARD} border-attn-edge bg-attn-soft`}>
      <p className="text-attn-ink text-sm font-semibold">{REGISTRATION_RETURNED_NOTICE_HEADING}</p>
      <p className="text-attn-ink mt-1 text-sm">{REGISTRATION_RETURNED_NOTICE_BODY}</p>
      <p className="text-attn-ink mt-2 text-sm whitespace-pre-line">{note}</p>
    </div>
  );
}
