"use client";
// Spec 329 §4 — the document list. One card per current doc: expiry badge,
// download (short-TTL signed URL minted by the page), share link, version
// history disclosure; manage controls (upload / new version / retire) render
// only for the accounting tier (canManage).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { retireCompanyDocument } from "@/lib/company-docs/actions";
import { expiryStatus } from "@/lib/company-docs/expiry";
import type { CompanyDocument } from "@/lib/company-docs/group-documents";
import { CompanyDocSheet, type SheetMode } from "./company-doc-sheets";
import { ShareLinkButton } from "./share-link-button";
import {
  COMPANY_DOC_DOWNLOAD_LABEL,
  COMPANY_DOC_EMPTY_LABEL,
  COMPANY_DOC_EXPIRED_LABEL,
  COMPANY_DOC_EXPIRING_LABEL,
  COMPANY_DOC_HISTORY_LABEL,
  COMPANY_DOC_NEW_VERSION_LABEL,
  COMPANY_DOC_RETIRE_CONFIRM_LABEL,
  COMPANY_DOC_RETIRE_LABEL,
  COMPANY_DOC_UPLOAD_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";

function ExpiryBadge({ expiresAt, todayIso }: { expiresAt: string | null; todayIso: string }) {
  const status = expiryStatus(expiresAt, new Date(`${todayIso}T00:00:00Z`));
  if (status === "expired") {
    return (
      <span className="bg-danger-soft text-danger-ink text-meta shrink-0 rounded-full px-2 py-0.5 font-medium">
        {COMPANY_DOC_EXPIRED_LABEL}
      </span>
    );
  }
  if (status === "expiring") {
    return (
      <span className="bg-attn-soft text-attn-ink text-meta shrink-0 rounded-full px-2 py-0.5 font-medium">
        {COMPANY_DOC_EXPIRING_LABEL}
      </span>
    );
  }
  return null;
}

function RetireControl({ headId }: { headId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retire() {
    setBusy(true);
    const r = await retireCompanyDocument({ headId });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setConfirming(false);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span aria-live="polite" className="inline-flex flex-col">
        <button
          type="button"
          disabled={busy}
          onClick={() => (confirming ? void retire() : setConfirming(true))}
          className={
            confirming
              ? "bg-danger-soft text-danger-ink border-danger-edge rounded-control border px-3 py-1.5 text-sm disabled:opacity-60"
              : "border-edge bg-card hover:bg-sunk text-ink-secondary rounded-control border px-3 py-1.5 text-sm"
          }
        >
          {confirming ? COMPANY_DOC_RETIRE_CONFIRM_LABEL : COMPANY_DOC_RETIRE_LABEL}
        </button>
        {error ? <span className="text-danger text-meta mt-1">{error}</span> : null}
      </span>
      {confirming && !busy ? (
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-ink-muted text-sm underline"
        >
          ยกเลิก
        </button>
      ) : null}
    </span>
  );
}

export function CompanyDocsView({
  docs,
  downloadUrls,
  canManage,
  todayIso,
}: {
  docs: CompanyDocument[];
  downloadUrls: Record<string, string>;
  canManage: boolean;
  todayIso: string;
}) {
  const [sheet, setSheet] = useState<SheetMode | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <button
          type="button"
          onClick={() => setSheet({ kind: "new" })}
          className="border-edge bg-card hover:bg-sunk text-ink rounded-control flex items-center justify-center gap-2 border px-4 py-2.5 font-semibold"
        >
          <Upload aria-hidden className="h-5 w-5" />
          {COMPANY_DOC_UPLOAD_LABEL}
        </button>
      ) : null}

      {docs.length === 0 ? (
        <p className="border-edge bg-card text-ink-secondary rounded-control border px-4 py-6 text-center text-sm">
          {COMPANY_DOC_EMPTY_LABEL}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map(({ head, history }) => (
            <li key={head.id} className="border-edge bg-card rounded-control border p-3">
              <div className="flex items-start gap-3">
                <FileText aria-hidden className="text-ink-secondary mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-ink text-body font-semibold">{head.title}</span>
                    <ExpiryBadge expiresAt={head.expires_at} todayIso={todayIso} />
                  </div>
                  <div className="text-ink-secondary text-meta mt-0.5 flex flex-wrap gap-x-2">
                    {head.issued_at ? <span>ออกให้ {formatThaiDate(head.issued_at)}</span> : null}
                    {head.expires_at ? (
                      <span>· หมดอายุ {formatThaiDate(head.expires_at)}</span>
                    ) : null}
                  </div>
                  {head.note ? (
                    <p className="text-ink-muted text-meta mt-0.5">{head.note}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {downloadUrls[head.id] ? (
                      <a
                        href={downloadUrls[head.id]}
                        target="_blank"
                        rel="noreferrer"
                        className="border-edge bg-card hover:bg-sunk text-ink rounded-control border px-3 py-1.5 text-sm"
                      >
                        {COMPANY_DOC_DOWNLOAD_LABEL}
                      </a>
                    ) : null}
                    {head.storage_path ? <ShareLinkButton storagePath={head.storage_path} /> : null}
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setSheet({
                              kind: "version",
                              supersedes: head.id,
                              prefillTitle: head.title ?? "",
                              prefillNote: head.note ?? "",
                            })
                          }
                          className="border-edge bg-card hover:bg-sunk text-ink rounded-control border px-3 py-1.5 text-sm"
                        >
                          {COMPANY_DOC_NEW_VERSION_LABEL}
                        </button>
                        <RetireControl headId={head.id} />
                      </>
                    ) : null}
                  </div>

                  {history.length > 0 ? (
                    <details className="mt-2">
                      <summary className="text-ink-secondary text-meta cursor-pointer">
                        {COMPANY_DOC_HISTORY_LABEL} ({history.length})
                      </summary>
                      <ul className="mt-1 flex flex-col gap-1 pl-4">
                        {history.map((v) => (
                          <li
                            key={v.id}
                            className="text-ink-muted text-meta flex items-center justify-between gap-2"
                          >
                            <span>
                              ฉบับ {formatThaiDate(v.created_at)}
                              {v.issued_at ? ` (ออกให้ ${formatThaiDate(v.issued_at)})` : ""}
                            </span>
                            {downloadUrls[v.id] ? (
                              <a
                                href={downloadUrls[v.id]}
                                target="_blank"
                                rel="noreferrer"
                                className="text-action underline"
                              >
                                {COMPANY_DOC_DOWNLOAD_LABEL}
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage ? <CompanyDocSheet mode={sheet} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
