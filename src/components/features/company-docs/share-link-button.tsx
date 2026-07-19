"use client";
// Spec 329 §5 — mint a 7-day signed URL and copy it to the clipboard.
import { useState } from "react";
import { mintCompanyDocShareLink } from "@/lib/company-docs/actions";
import { COMPANY_DOC_SHARE_COPIED_LABEL, COMPANY_DOC_SHARE_LABEL } from "@/lib/i18n/labels";

export function ShareLinkButton({ storagePath }: { storagePath: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setError(null);
    const r = await mintCompanyDocShareLink({ storagePath });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await navigator.clipboard.writeText(r.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => void share()}
        className="border-edge bg-card hover:bg-sunk text-ink rounded-control border px-3 py-1.5 text-sm"
      >
        {copied ? COMPANY_DOC_SHARE_COPIED_LABEL : COMPANY_DOC_SHARE_LABEL}
      </button>
      {error ? <span className="text-danger text-meta mt-1">{error}</span> : null}
    </span>
  );
}
