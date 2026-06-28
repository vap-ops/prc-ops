// Bug 8e9c9fc7 — the conversation detail page showed no attached images, so the
// operator reviewing a report (and the reporter) could not see the screenshots they
// rely on. This renders the report's attachments as clickable thumbnails (open the
// full image in a new tab). Presentational only — the signed URLs are minted server
// side via loadFeedbackAttachmentUrls. Renders nothing when there are no attachments.

export function FeedbackAttachmentGallery({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-secondary text-sm font-medium">รูปที่แนบมา</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:ring-action rounded-control focus:outline-none focus-visible:ring-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`รูปแนบ ${i + 1}`}
              className="rounded-control border-edge size-24 border object-cover"
            />
          </a>
        ))}
      </div>
    </div>
  );
}
