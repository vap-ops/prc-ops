"use client";
// Spec 329 §4 — the upload bottom sheet, two modes: new document, new version
// (prefilled title/note + supersedes). Bytes first via the browser client
// (storage INSERT policy gates), then the metadata action (table RLS gates).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { addCompanyDocument, addCompanyDocumentVersion } from "@/lib/company-docs/actions";
import { uploadCompanyDocFile } from "@/lib/company-docs/upload-company-doc";
import {
  COMPANY_DOC_EXPIRES_LABEL,
  COMPANY_DOC_FILE_LABEL,
  COMPANY_DOC_ISSUED_LABEL,
  COMPANY_DOC_NEW_VERSION_LABEL,
  COMPANY_DOC_NOTE_LABEL,
  COMPANY_DOC_TITLE_LABEL,
  COMPANY_DOC_UPLOAD_LABEL,
} from "@/lib/i18n/labels";

export interface SheetMode {
  kind: "new" | "version";
  supersedes?: string;
  prefillTitle?: string;
  prefillNote?: string;
}

export function CompanyDocSheet({
  mode,
  onClose,
}: {
  mode: SheetMode | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    const file = form.get("file");
    const title = String(form.get("title") ?? "").trim();
    if (!(file instanceof File) || file.size === 0 || title === "" || mode === null) {
      setError("กรุณาเลือกไฟล์และกรอกชื่อเอกสาร");
      return;
    }
    setBusy(true);
    setError(null);
    const uploaded = await uploadCompanyDocFile(file);
    if ("error" in uploaded) {
      setBusy(false);
      setError(uploaded.error);
      return;
    }
    const note = String(form.get("note") ?? "").trim();
    const issuedAt = String(form.get("issued_at") ?? "");
    const expiresAt = String(form.get("expires_at") ?? "");
    const input = {
      id: uploaded.id,
      title,
      note: note === "" ? null : note,
      issuedAt: issuedAt === "" ? null : issuedAt,
      expiresAt: expiresAt === "" ? null : expiresAt,
      storagePath: uploaded.path,
    };
    const r =
      mode.kind === "version" && mode.supersedes !== undefined
        ? await addCompanyDocumentVersion({ ...input, supersedes: mode.supersedes })
        : await addCompanyDocument(input);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <BottomSheet
      open={mode !== null}
      title={mode?.kind === "version" ? COMPANY_DOC_NEW_VERSION_LABEL : COMPANY_DOC_UPLOAD_LABEL}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-ink-secondary text-sm">{COMPANY_DOC_FILE_LABEL}</span>
          <input
            type="file"
            name="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="text-ink text-sm"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-secondary text-sm">{COMPANY_DOC_TITLE_LABEL}</span>
          <input
            type="text"
            name="title"
            defaultValue={mode?.prefillTitle ?? ""}
            maxLength={200}
            className="border-edge bg-card text-ink rounded-control border px-3 py-2 text-base"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-secondary text-sm">{COMPANY_DOC_NOTE_LABEL}</span>
          <input
            type="text"
            name="note"
            defaultValue={mode?.prefillNote ?? ""}
            className="border-edge bg-card text-ink rounded-control border px-3 py-2 text-base"
          />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-ink-secondary text-sm">{COMPANY_DOC_ISSUED_LABEL}</span>
            <input
              type="date"
              name="issued_at"
              className="border-edge bg-card text-ink rounded-control border px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-ink-secondary text-sm">{COMPANY_DOC_EXPIRES_LABEL}</span>
            <input
              type="date"
              name="expires_at"
              className="border-edge bg-card text-ink rounded-control border px-3 py-2 text-base"
            />
          </label>
        </div>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="bg-action text-on-fill rounded-control px-4 py-2.5 text-base font-semibold disabled:opacity-60"
        >
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </form>
    </BottomSheet>
  );
}
