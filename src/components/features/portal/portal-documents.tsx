"use client";

// Spec 131 U2c — the DC self-service document block on /portal. A bound DC uploads
// their own onboarding documents (ID card, bank book, consent, house registration,
// insurance) straight to the private contact-docs bucket at their OWN contractor
// path, then records the row via the own-doc action. Mirrors the PM
// ContactDocumentsBlock upload machine (spec 97), but on the browser RLS client +
// the own-doc server action — never the admin client (ADR 0051 §5). The storage
// WITH CHECK + the RPC's own-contractor gate reject any path outside this DC's
// folder, so a tampered client cannot reach another contractor's documents.
//
// 'use client' justified: file input + per-document upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addOwnContactDocument } from "@/lib/portal/actions";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { buildContactDocPath } from "@/lib/contacts/document-path";
import {
  PORTAL_DOC_PURPOSES,
  PORTAL_DOC_LABELS,
  type PortalDocPurpose,
} from "@/lib/portal/document-types";
import { CARD, BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function PortalDocuments({
  contractorId,
  urls,
}: {
  contractorId: string;
  urls: Partial<Record<PortalDocPurpose, string>>;
}) {
  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เอกสารของฉัน</p>
      <p className="text-ink-muted mt-0.5 text-xs">
        อัปโหลดเอกสารของท่าน เฉพาะบริษัทและท่านเท่านั้นที่เห็น
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {PORTAL_DOC_PURPOSES.map((purpose) => (
          <DocRow
            key={purpose}
            contractorId={contractorId}
            purpose={purpose}
            currentUrl={urls[purpose] ?? null}
          />
        ))}
      </div>
    </div>
  );
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

function DocRow({
  contractorId,
  purpose,
  currentUrl,
}: {
  contractorId: string;
  purpose: PortalDocPurpose;
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
    const path = buildContactDocPath("contractor", contractorId, attachmentId, ext);
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
    let result: Awaited<ReturnType<typeof addOwnContactDocument>>;
    try {
      result = await addOwnContactDocument({ purpose, attachmentId, ext });
    } catch (err) {
      console.error("[portal-documents] action invocation failed", err);
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
      <p className="text-ink text-sm font-medium">{PORTAL_DOC_LABELS[purpose]}</p>
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentUrl}
          alt={PORTAL_DOC_LABELS[purpose]}
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
