"use client";
// Spec 329 §5 — mint a 7-day signed URL and copy it to the clipboard.
import { useState } from "react";
import { mintCompanyDocShareLink } from "@/lib/company-docs/actions";
import { COMPANY_DOC_SHARE_COPIED_LABEL, COMPANY_DOC_SHARE_LABEL } from "@/lib/i18n/labels";

export function ShareLinkButton({ storagePath }: { storagePath: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Clipboard write can reject (insecure context, unfocused document) — the
  // minted link then surfaces here for manual copy instead of vanishing.
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    setFallbackUrl(null);
    const r = await mintCompanyDocShareLink({ storagePath });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(r.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setFallbackUrl(r.url);
    }
  }

  return (
    <span className="inline-flex flex-col" aria-live="polite">
      <button
        type="button"
        disabled={busy}
        onClick={() => void share()}
        className="border-edge bg-card hover:bg-sunk text-ink rounded-control border px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {copied ? COMPANY_DOC_SHARE_COPIED_LABEL : COMPANY_DOC_SHARE_LABEL}
      </button>
      {error ? <span className="text-danger text-meta mt-1">{error}</span> : null}
      {fallbackUrl ? (
        <input
          readOnly
          value={fallbackUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={COMPANY_DOC_SHARE_LABEL}
          className="border-edge bg-card text-ink text-meta mt-1 w-56 rounded border px-2 py-1"
        />
      ) : null}
    </span>
  );
}
