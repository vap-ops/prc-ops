"use client";

// Spec 315 U1 — the ช่าง's ID-card renewal card on /technician. An ID card
// expires; the registration form froze documents at approval, so this card lets
// an APPROVED technician re-submit their id_card (self-serve supersede — the
// prior photo stays in the append-only attachment chain; no approval queue,
// operator decision 2026-07-14). Upload flow mirrors the registration form's
// DocRow: prepare → own-folder storage upload → addStaffRegistrationDoc.
// 'use client' justified: file-input + upload state machine + server-action call.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStaffRegistrationDoc } from "@/lib/register/actions";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import { STAFF_DOC_LABELS } from "@/lib/register/document-types";
import { BUTTON_SECONDARY_MUTED, CARD, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

type UploadPhase = "idle" | "uploading" | "saving" | "error";

export function WorkerIdCardUpdate({
  uid,
  currentUrl,
}: {
  uid: string;
  currentUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // Synchronous re-entry guard: phase state only lands after a re-render, so a
  // second change event during a slow prepare (HEIC downscale) would double-run
  // the whole upload → two attachment rows. The ref closes that window.
  const inFlightRef = useRef(false);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setPhase("uploading");

    try {
      await runUpload(file);
    } finally {
      inFlightRef.current = false;
    }
  }

  async function runUpload(file: File) {
    const prepared = await preparePhotoForUpload(file);
    if (!prepared) {
      setPhase("error");
      setError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพ (JPEG, PNG, WebP, HEIC)");
      return;
    }
    const ext = prepared.ext;
    const attachmentId = crypto.randomUUID();
    const path = buildTechnicianDocPath(uid, "id_card", attachmentId, ext);
    if (!path) {
      setPhase("error");
      setError("บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      return;
    }

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
    let result: Awaited<ReturnType<typeof addStaffRegistrationDoc>>;
    try {
      result = await addStaffRegistrationDoc({ purpose: "id_card", attachmentId, ext });
    } catch (err) {
      console.error("[worker-id-card-update] doc action invocation failed", err);
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
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">{STAFF_DOC_LABELS.id_card}</p>
      <p className="text-ink-muted mt-0.5 text-xs">
        บัตรหมดอายุหรือทำบัตรใหม่ อัปโหลดรูปบัตรใบใหม่ได้ที่นี่ (รูปเดิมยังถูกเก็บไว้)
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={STAFF_DOC_LABELS.id_card}
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
              : "อัปเดตบัตรประชาชน"}
        </button>
        {error ? (
          <p role="alert" className={INLINE_ALERT_TEXT}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
