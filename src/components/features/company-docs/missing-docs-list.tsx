"use client";
// Spec 331 §6 — the ยังขาด section. Standardizing the types is what makes this
// possible: the registry declares which documents the company must hold, so the
// library can state what is MISSING, not just what it has.
//
// Hidden entirely from read-only viewers: they cannot upload, so a checklist they
// can't action is nagging, not information (§0 omotenashi test, spec 325).
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { DocTypeRow } from "@/lib/company-docs/registry";
import {
  COMPANY_DOC_MISSING_HEADING,
  COMPANY_DOC_MISSING_HINT,
  COMPANY_DOC_MISSING_NONE,
  COMPANY_DOC_UPLOAD_LABEL,
} from "@/lib/i18n/labels";

export function MissingDocsList({
  missing,
  canManage,
  onUpload,
}: {
  missing: DocTypeRow[];
  canManage: boolean;
  onUpload: (type: DocTypeRow) => void;
}) {
  if (!canManage) return null;

  if (missing.length === 0) {
    return (
      <p className="border-edge bg-card text-ink-secondary rounded-control flex items-center gap-2 border px-4 py-3 text-sm">
        <CheckCircle2 aria-hidden className="text-done h-5 w-5 shrink-0" />
        {COMPANY_DOC_MISSING_NONE}
      </p>
    );
  }

  return (
    <section aria-label={COMPANY_DOC_MISSING_HEADING} className="flex flex-col gap-2">
      <div>
        <h2 className="text-ink text-body font-semibold">
          {COMPANY_DOC_MISSING_HEADING} ({missing.length})
        </h2>
        <p className="text-ink-secondary text-meta">{COMPANY_DOC_MISSING_HINT}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {missing.map((t) => (
          <li
            key={t.id}
            className="border-attn-edge bg-attn-soft rounded-control flex items-center gap-3 border p-3"
          >
            <AlertTriangle aria-hidden className="text-attn-ink h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="text-attn-ink text-body block font-semibold">{t.name_th}</span>
              {t.hint ? (
                <span className="text-attn-ink text-meta block opacity-80">{t.hint}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => onUpload(t)}
              className="border-edge bg-card hover:bg-sunk text-ink rounded-control shrink-0 border px-3 py-1.5 text-sm"
            >
              {COMPANY_DOC_UPLOAD_LABEL}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
