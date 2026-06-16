"use client";

// Spec 97 — Contacts v2 Unit 7: the PM-only document block on the contact detail
// page (contractor / supplier / service provider). Shows the current ID-card and
// bank-book images (signed URLs minted server-side by the admin client — the page
// is requireRole(PM_ROLES)-gated) and an uploader per document.
//
// Upload flow mirrors the invoice uploader (spec 66): prepare (spec 34 downscale)
// → bytes direct to the private contact-docs bucket at the canonical path →
// addContactDocument (records the row via the SECURITY DEFINER RPC; the path is
// rebuilt server-side) → refresh.
//
// 'use client' justified: file input + per-document upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addContactDocument } from "@/app/contacts/actions";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import {
  buildContactDocPath,
  type ContactDocKind,
  type ContractorDocPurpose,
} from "@/lib/contacts/document-path";
import { CARD, BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

const PURPOSE_LABEL: Record<ContractorDocPurpose, string> = {
  id_card: "บัตรประชาชน",
  bank_book: "สมุดบัญชีธนาคาร",
  company_cert: "หนังสือรับรองบริษัท",
  vat_cert: "ภ.พ.20",
};

export function ContactDocumentsBlock({
  kind,
  id,
  idCardUrl,
  bankBookUrl,
  companyCertUrl,
  vatCertUrl,
  showCompanyDocs = false,
}: {
  kind: ContactDocKind;
  id: string;
  idCardUrl: string | null;
  bankBookUrl: string | null;
  // Spec 131 U3 — company papers (company DC only). Optional so suppliers /
  // service providers (and individual DCs) render just the base two rows.
  companyCertUrl?: string | null;
  vatCertUrl?: string | null;
  showCompanyDocs?: boolean;
}) {
  return (
    <section className={CARD}>
      <p className="text-ink text-sm font-semibold">เอกสาร</p>
      <p className="text-ink-muted mt-0.5 text-xs">เฉพาะผู้จัดการเห็นเอกสารนี้</p>
      <div className="mt-3 flex flex-col gap-4">
        <DocRow kind={kind} id={id} purpose="id_card" currentUrl={idCardUrl} />
        <DocRow kind={kind} id={id} purpose="bank_book" currentUrl={bankBookUrl} />
        {showCompanyDocs ? (
          <>
            <DocRow
              kind={kind}
              id={id}
              purpose="company_cert"
              currentUrl={companyCertUrl ?? null}
            />
            <DocRow kind={kind} id={id} purpose="vat_cert" currentUrl={vatCertUrl ?? null} />
          </>
        ) : null}
      </div>
    </section>
  );
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

function DocRow({
  kind,
  id,
  purpose,
  currentUrl,
}: {
  kind: ContactDocKind;
  id: string;
  purpose: ContractorDocPurpose;
  currentUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);

    const prepared = await preparePhotoForUpload(file);
    if (!prepared) {
      setPhase("error");
      setError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพ (JPEG, PNG, WebP, HEIC)");
      return;
    }
    const ext = prepared.ext;
    const attachmentId = crypto.randomUUID();
    const path = buildContactDocPath(kind, id, attachmentId, ext);
    if (!path) {
      setPhase("error");
      setError("บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      return;
    }

    setPhase("uploading");
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(CONTACT_DOCS_BUCKET)
      .upload(path, prepared.blob, { upsert: false, contentType: photoExtToMime(ext) });
    if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
      setPhase("error");
      setError("ส่งเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      return;
    }

    setPhase("saving");
    let result: Awaited<ReturnType<typeof addContactDocument>>;
    try {
      result = await addContactDocument({ kind, id, purpose, attachmentId, ext });
    } catch (err) {
      console.error("[contact-documents] action invocation failed", err);
      result = { ok: false, error: "บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }
    if (!result.ok) {
      setPhase("error");
      setError(result.error);
      return;
    }

    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
    startRefresh(() => router.refresh());
  }

  const busy = phase === "uploading" || phase === "saving";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink text-sm font-medium">{PURPOSE_LABEL[purpose]}</p>
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentUrl}
          alt={PURPOSE_LABEL[purpose]}
          className="border-edge rounded-control h-40 w-full border object-contain"
        />
      ) : (
        <p className="text-ink-muted text-xs">ยังไม่มีเอกสาร</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT_MIME}
        className="sr-only"
        onChange={(e) => void handleFile(e.target.files)}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={BUTTON_SECONDARY_MUTED}
      >
        {phase === "uploading"
          ? "กำลังอัปโหลด…"
          : phase === "saving"
            ? "กำลังบันทึก…"
            : currentUrl
              ? "เปลี่ยนรูป"
              : "อัปโหลด"}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
