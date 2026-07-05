// Spec 263 U3 / spec 264 G2 — read-only document display for the review detail
// / SA read view. Server component (no upload affordance — reviewers never
// write docs, only the applicant does via the one-page StaffRegistrationForm,
// spec 264 G2). Renders the 2 staff_doc_purpose slots (id_card/profile_photo —
// `consent` retired, it's now a PDPA consent record, not a document); a
// purpose with no live upload shows a placeholder line instead of an image.

import { CARD } from "@/lib/ui/classes";
import {
  STAFF_DOC_PURPOSES,
  STAFF_DOC_LABELS,
  type StaffDocPurpose,
} from "@/lib/register/document-types";

export function RegistrationDocumentsView({
  urls,
}: {
  urls: Partial<Record<StaffDocPurpose, string>>;
}) {
  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เอกสาร</p>
      <div className="mt-3 flex flex-col gap-4">
        {STAFF_DOC_PURPOSES.map((purpose) => (
          <div key={purpose} className="flex flex-col gap-2">
            <p className="text-ink text-sm font-medium">{STAFF_DOC_LABELS[purpose]}</p>
            {urls[purpose] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls[purpose]}
                alt={STAFF_DOC_LABELS[purpose]}
                className="border-edge rounded-control h-40 w-full border object-contain"
              />
            ) : (
              <p className="text-ink-muted text-xs">ยังไม่มีเอกสาร</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
