"use client";
// Spec 329 §4 — the upload bottom sheet, two modes: new document, new version
// (prefilled title/note + supersedes). Bytes first via the browser client
// (storage INSERT policy gates), then the metadata action (table RLS gates).
// Picker = sr-only input behind a dashed pick-area (expense-uploader idiom) —
// operator feedback 2026-07-19: the bare file input read as unclear.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, UploadCloud } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { addCompanyDocument, addCompanyDocumentVersion } from "@/lib/company-docs/actions";
import { uploadCompanyDocFile } from "@/lib/company-docs/upload-company-doc";
import {
  COMPANY_DOC_EXPIRES_LABEL,
  COMPANY_DOC_FILE_LABEL,
  COMPANY_DOC_FILE_TOO_BIG,
  COMPANY_DOC_ISSUED_LABEL,
  COMPANY_DOC_NEW_VERSION_LABEL,
  COMPANY_DOC_NOTE_LABEL,
  COMPANY_DOC_PICK_CHANGE_LABEL,
  COMPANY_DOC_PICK_HINT,
  COMPANY_DOC_PICK_LABEL,
  COMPANY_DOC_TITLE_LABEL,
  COMPANY_DOC_UPLOAD_LABEL,
} from "@/lib/i18n/labels";

// The company-docs bucket caps objects at 25 MiB — pre-check here so the user
// gets a Thai message instead of the raw storage error.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
  return (
    <BottomSheet
      open={mode !== null}
      title={mode?.kind === "version" ? COMPANY_DOC_NEW_VERSION_LABEL : COMPANY_DOC_UPLOAD_LABEL}
      onClose={onClose}
    >
      {/* Form state lives in a child that unmounts whenever the sheet closes or
          the mode switches — a reopened sheet can never silently reuse the
          PREVIOUS file's bytes under a new title (fresh-eyes 🔴, 2026-07-19). */}
      {mode !== null ? (
        <SheetForm key={`${mode.kind}:${mode.supersedes ?? "new"}`} mode={mode} onClose={onClose} />
      ) : null}
    </BottomSheet>
  );
}

function SheetForm({ mode, onClose }: { mode: SheetMode; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  function onPick(files: FileList | null) {
    const file = files?.[0] ?? null;
    if (file === null) return;
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      setPicked(null);
      setPickError(COMPANY_DOC_FILE_TOO_BIG);
      return;
    }
    setPickError(null);
    setPicked(file);
  }

  async function submit(form: FormData) {
    const file = picked;
    const title = String(form.get("title") ?? "").trim();
    if (file === null || file.size === 0 || title === "") {
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
    <>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-ink-secondary text-sm">{COMPANY_DOC_FILE_LABEL}</span>
          <label
            className={
              picked
                ? "border-action bg-action-soft rounded-control focus-within:ring-action flex cursor-pointer items-center gap-3 border px-4 py-3 focus-within:ring-2"
                : "border-edge bg-card hover:bg-sunk rounded-control focus-within:ring-action flex cursor-pointer items-center gap-3 border border-dashed px-4 py-4 focus-within:ring-2"
            }
          >
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label={picked ? COMPANY_DOC_PICK_CHANGE_LABEL : COMPANY_DOC_PICK_LABEL}
              onChange={(e) => {
                onPick(e.target.files);
                // reset so re-selecting the same file still fires change
                e.target.value = "";
              }}
            />
            {picked ? (
              <>
                <FileText aria-hidden className="text-action h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span
                    title={picked.name}
                    className="text-ink text-body block truncate font-semibold"
                  >
                    {picked.name}
                  </span>
                  <span className="text-ink-secondary text-meta block">
                    {fileSizeLabel(picked.size)} · {COMPANY_DOC_PICK_CHANGE_LABEL}
                  </span>
                </span>
              </>
            ) : (
              <>
                <UploadCloud aria-hidden className="text-ink-muted h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="text-ink text-body block font-semibold">
                    {COMPANY_DOC_PICK_LABEL}
                  </span>
                  <span className="text-ink-secondary text-meta block">
                    {COMPANY_DOC_PICK_HINT}
                  </span>
                </span>
              </>
            )}
          </label>
          {pickError ? (
            <p role="alert" className="text-danger text-sm">
              {pickError}
            </p>
          ) : null}
        </div>
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
    </>
  );
}
