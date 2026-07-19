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
import type { DocTypeGroup, DocTypeRow } from "@/lib/company-docs/registry";
import { CompanyDocSheet, type SheetMode } from "./company-doc-sheets";
import { MissingDocsList } from "./missing-docs-list";
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
  COMPANY_DOC_OTHER_CATEGORY_LABEL,
  COMPANY_DOC_UPLOAD_OTHER_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";

// Spec 331: a card's name comes from its TYPE (+ label for multi types).
// `title` is only the snapshot taken at upload, and the three grandfathered
// pre-331 rows carry no type at all — they fall back to it.
function docDisplayName(
  head: CompanyDocument["head"],
  typesById: Record<string, DocTypeRow>,
): string {
  const type = head.type_id === null ? undefined : typesById[head.type_id];
  if (type === undefined) return head.title ?? "";
  return head.label === null ? type.name_th : `${type.name_th} – ${head.label}`;
}

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
  groups = [],
  typesById = {},
  missing = [],
}: {
  docs: CompanyDocument[];
  downloadUrls: Record<string, string>;
  canManage: boolean;
  todayIso: string;
  groups?: DocTypeGroup[];
  typesById?: Record<string, DocTypeRow>;
  missing?: DocTypeRow[];
}) {
  const [sheet, setSheet] = useState<SheetMode | null>(null);

  // Spec 331 §6: cards sit under their CATEGORY heading — the registry is what
  // makes that possible, and a flat list wastes it. Category order follows the
  // registry's sort_order; a category with no documents is not rendered.
  const sections = groups
    .map((g) => ({
      category: g.category,
      docs: docs.filter(({ head }) => {
        const t = head.type_id === null ? undefined : typesById[head.type_id];
        return t !== undefined && t.category_id === g.category.id;
      }),
    }))
    .filter((s) => s.docs.length > 0);

  // Anything whose type was removed from the registry (or the grandfathered
  // pre-331 rows) must still appear — never silently drop a document.
  const grouped = new Set(sections.flatMap((s) => s.docs.map((d) => d.head.id)));
  const ungrouped = docs.filter((d) => !grouped.has(d.head.id));

  return (
    <div className="flex flex-col gap-5">
      <MissingDocsList
        missing={missing}
        canManage={canManage}
        onUpload={(t) => setSheet({ kind: "new", lockedType: t })}
      />

      {docs.length === 0 ? (
        <p className="border-edge bg-card text-ink-secondary rounded-control border px-4 py-6 text-center text-sm">
          {COMPANY_DOC_EMPTY_LABEL}
        </p>
      ) : (
        <>
          {[
            ...sections.map((s) => ({
              key: s.category.id,
              title: s.category.name_th,
              docs: s.docs,
            })),
            ...(ungrouped.length > 0
              ? [{ key: "other", title: COMPANY_DOC_OTHER_CATEGORY_LABEL, docs: ungrouped }]
              : []),
          ].map((section) => (
            <section key={section.key} aria-label={section.title} className="flex flex-col gap-2">
              <h2 className="text-ink-secondary text-meta font-semibold">{section.title}</h2>
              <ul className="flex flex-col gap-2">
                {section.docs.map(({ head, history }) => (
                  <li key={head.id} className="border-edge bg-card rounded-control border p-3">
                    <div className="flex items-start gap-3">
                      <FileText
                        aria-hidden
                        className="text-ink-secondary mt-0.5 h-5 w-5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-ink text-body font-semibold">
                            {docDisplayName(head, typesById)}
                          </span>
                          <ExpiryBadge expiresAt={head.expires_at} todayIso={todayIso} />
                        </div>
                        <div className="text-ink-secondary text-meta mt-0.5 flex flex-wrap gap-x-2">
                          {head.issued_at ? (
                            <span>ออกให้ {formatThaiDate(head.issued_at)}</span>
                          ) : null}
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
                          {head.storage_path ? (
                            <ShareLinkButton storagePath={head.storage_path} />
                          ) : null}
                          {canManage ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setSheet({
                                    kind: "version",
                                    supersedes: head.id,
                                    prefillNote: head.note ?? "",
                                    // the DB refuses a type change on a version, so the
                                    // picker opens locked to the chain's own type
                                    ...(head.type_id !== null &&
                                    typesById[head.type_id] !== undefined
                                      ? { lockedType: typesById[head.type_id] as DocTypeRow }
                                      : {}),
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
            </section>
          ))}
        </>
      )}

      {/* The generic upload. ยังขาด drives the REQUIRED documents with a button
          per row, so this only covers extras (an insurance policy, an ISO cert)
          — a quiet action at the end, not a banner at the top (operator
          feedback 2026-07-19). */}
      {canManage ? (
        <button
          type="button"
          onClick={() => setSheet({ kind: "new" })}
          className="border-edge bg-card hover:bg-sunk text-ink-secondary rounded-control flex items-center justify-center gap-2 self-start border px-3 py-1.5 text-sm"
        >
          <Upload aria-hidden className="h-4 w-4" />
          {COMPANY_DOC_UPLOAD_OTHER_LABEL}
        </button>
      ) : null}

      {canManage ? (
        <CompanyDocSheet mode={sheet} groups={groups} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  );
}
