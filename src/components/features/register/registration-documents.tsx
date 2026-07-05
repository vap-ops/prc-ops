"use client";

// Spec 263 U2 / spec 264 G1 — the applicant document upload block: id_card,
// profile_photo (consent dropped — PDPA consent is an in-app record now, G2
// wires the checkbox). Mirrors PortalDocuments' upload machine (spec 131 U2c) —
// uploads straight to the private contact-docs bucket at the applicant's OWN
// path (technician/<uid>/<purpose>/…), then records the row via
// addTechnicianRegistrationDoc. RLS session client only (never admin), per the
// external/visitor-reachable discipline. profile_photo is what the e-employee
// card renders (self-editable — a re-upload supersedes).
//
// 'use client' justified: file input + per-document upload state machine.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTechnicianRegistrationDoc } from "@/lib/register/actions";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import {
  TECHNICIAN_DOC_PURPOSES,
  TECHNICIAN_DOC_LABELS,
  type TechnicianDocPurpose,
} from "@/lib/register/document-types";
import { CARD, BUTTON_SECONDARY_MUTED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

export function RegistrationDocuments({
  uid,
  urls,
}: {
  uid: string;
  urls: Partial<Record<TechnicianDocPurpose, string>>;
}) {
  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เอกสาร</p>
      <p className="text-ink-muted mt-0.5 text-xs">
        อัปโหลดเอกสารของท่าน เฉพาะบริษัทและท่านเท่านั้นที่เห็น
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {TECHNICIAN_DOC_PURPOSES.map((purpose) => (
          <DocRow key={purpose} uid={uid} purpose={purpose} currentUrl={urls[purpose] ?? null} />
        ))}
      </div>
    </div>
  );
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

function DocRow({
  uid,
  purpose,
  currentUrl,
}: {
  uid: string;
  purpose: TechnicianDocPurpose;
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
    const path = buildTechnicianDocPath(uid, purpose, attachmentId, ext);
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
    let result: Awaited<ReturnType<typeof addTechnicianRegistrationDoc>>;
    try {
      result = await addTechnicianRegistrationDoc({ purpose, attachmentId, ext });
    } catch (err) {
      console.error("[registration-documents] action invocation failed", err);
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
      <p className="text-ink text-sm font-medium">{TECHNICIAN_DOC_LABELS[purpose]}</p>
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentUrl}
          alt={TECHNICIAN_DOC_LABELS[purpose]}
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
              ? "เปลี่ยนไฟล์"
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
