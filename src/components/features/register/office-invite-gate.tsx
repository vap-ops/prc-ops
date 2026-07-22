// Spec 342 D3 — what a bare /register/office renders. A guidance screen, not a
// 404: someone TOLD to open this URL must learn what to do next, not dead-end.
// The organic office door is closed (invite-only); the field door stays open.
import Link from "next/link";
import { CARD, BUTTON_SECONDARY } from "@/lib/ui/classes";
import { REGISTER_FIELD_PATH } from "@/lib/register/register-entry";
import {
  OFFICE_INVITE_REQUIRED_HEADING,
  OFFICE_INVITE_REQUIRED_HINT,
  REGISTER_FIELD_HEADING,
} from "@/lib/i18n/labels";

export function OfficeInviteGate() {
  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">{OFFICE_INVITE_REQUIRED_HEADING}</p>
      <p className="text-ink-muted mt-1 text-sm">{OFFICE_INVITE_REQUIRED_HINT}</p>
      <Link href={REGISTER_FIELD_PATH} className={`${BUTTON_SECONDARY} mt-3 w-full`}>
        {REGISTER_FIELD_HEADING}
      </Link>
    </div>
  );
}
