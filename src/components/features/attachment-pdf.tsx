// Spec 121 / ADR 0046 Layer A — PDF attachment viewer. A private-bucket
// signed URL rendered in an <iframe> (the ADR's iframe/embed viewer; PDF.js
// only if controls are later needed) plus an open-in-new-tab fallback link
// (signed URLs expire; some mobile browsers don't render a PDF inline). Image
// attachments keep ZoomablePhoto/the lightbox — this is the pdf-kind branch.
//
// Presentational, no hooks → server-renderable (used inside the request-detail
// Server Component; no client boundary, no serialization concern).

import { FileText } from "lucide-react";

export function AttachmentPdf({ src, label }: { src: string; label?: string }) {
  return (
    <div className="border-edge bg-card flex flex-col gap-1.5 rounded-lg border p-2">
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="text-action inline-flex items-center gap-1.5 text-xs font-medium underline-offset-2 hover:underline"
      >
        <FileText aria-hidden className="size-4 shrink-0" />
        เปิดเอกสาร PDF ในแท็บใหม่
      </a>
      <iframe
        src={`${src}#view=Fit`}
        title={label ?? "เอกสาร PDF"}
        className="border-edge bg-sunk h-[82vh] w-full rounded-md border"
      />
    </div>
  );
}
