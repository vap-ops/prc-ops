// Spec 263 U3 — read-only document display for the review detail / SA read
// view. Server component (no upload affordance — reviewers never write docs,
// only the applicant does via RegistrationDocuments, spec 263 U2). Renders the
// 3 technician_doc_purpose slots (id_card/consent/profile_photo); a purpose
// with no live upload shows a placeholder line instead of an image.

import { CARD } from "@/lib/ui/classes";
import {
  TECHNICIAN_DOC_PURPOSES,
  TECHNICIAN_DOC_LABELS,
  type TechnicianDocPurpose,
} from "@/lib/register/document-types";

export function RegistrationDocumentsView({
  urls,
}: {
  urls: Partial<Record<TechnicianDocPurpose, string>>;
}) {
  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เอกสาร</p>
      <div className="mt-3 flex flex-col gap-4">
        {TECHNICIAN_DOC_PURPOSES.map((purpose) => (
          <div key={purpose} className="flex flex-col gap-2">
            <p className="text-ink text-sm font-medium">{TECHNICIAN_DOC_LABELS[purpose]}</p>
            {urls[purpose] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls[purpose]}
                alt={TECHNICIAN_DOC_LABELS[purpose]}
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
