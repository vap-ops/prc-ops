// Spec 302 — the ใบส่งของ/ใบเสร็จ attachment display, extracted from the PR
// page's standalone เอกสาร card so the same block can render inside the
// การรับของ card at the receive moment (on_route/delivered) and in the
// standalone card for the pre-delivery states. Server component — pure
// presentation; ZoomablePhoto/AttachmentRemoveButton are the client leaves.

import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { AttachmentRemoveButton } from "@/components/features/purchasing/attachment-remove-button";

interface InvoiceDoc {
  id: string | null;
  created_by: string | null;
}

interface InvoiceDocsDisplayProps {
  images: InvoiceDoc[];
  pdfs: InvoiceDoc[];
  urls: ReadonlyMap<string, string>;
  /** The signed-in viewer — remove buttons appear only on their own uploads. */
  viewerId: string;
}

export function InvoiceDocsDisplay({ images, pdfs, urls, viewerId }: InvoiceDocsDisplayProps) {
  if (images.length === 0 && pdfs.length === 0) return null;
  return (
    <>
      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((doc, idx, arr) => {
            const url = doc.id ? urls.get(doc.id) : undefined;
            if (!doc.id || !url) return null;
            /* Spec 50: invoice images form their own lightbox group. */
            const groupUrls = arr.flatMap((a) =>
              a.id && urls.get(a.id) ? [urls.get(a.id) as string] : [],
            );
            const groupIndex = arr.slice(0, idx).filter((a) => a.id && urls.get(a.id)).length;
            return (
              <li key={doc.id} className="flex flex-col items-center gap-0.5">
                <span className="border-edge block h-20 w-20 overflow-hidden rounded-lg border">
                  <ZoomablePhoto src={url} group={groupUrls} groupIndex={groupIndex} />
                </span>
                {doc.created_by === viewerId ? (
                  <AttachmentRemoveButton attachmentId={doc.id} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {/* Spec 121: invoice PDFs render in the iframe viewer. */}
      {pdfs.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {pdfs.map((doc) => {
            const url = doc.id ? urls.get(doc.id) : undefined;
            if (!doc.id || !url) return null;
            return (
              <li key={doc.id} className="flex flex-col gap-0.5">
                <AttachmentPdf src={url} />
                {doc.created_by === viewerId ? (
                  <AttachmentRemoveButton attachmentId={doc.id} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
