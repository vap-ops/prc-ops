"use client";

// Spec 170 U4c-2 — the ช่าง bank-change request form on /technician. The worker
// analogue of BankChangeForm (contractors): a bound worker submits new bank
// details; they land PENDING for PM approval (ADR 0051 §6), never live
// immediately. While a request is pending, the form is replaced by a waiting
// notice. 'use client': form + pending state + the server-action call. Reuses
// validateBankChange — the shape/UX rules are identical to the contractor form.
//
// Spec 315 U2 — a passbook photo is REQUIRED (operator decision 2026-07-14; the
// approver verifies the typed account number against it). The photo uploads to
// the caller's own technician/<uid>/book_bank/ folder at submit, then the action
// passes {attachmentId, ext} for the server to rebuild the path.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitWorkerBankChange } from "@/lib/portal/actions";
import { validateBankChange } from "@/lib/portal/bank-change";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  CARD,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

export function WorkerBankChangeForm({ uid, hasPending }: { uid: string; hasPending: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [bankName, setBankName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [accountName, setAccountName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (hasPending) {
    return (
      <div className={`${CARD} border-attn bg-attn-soft border-l-4`}>
        <p className="text-attn-ink text-sm font-medium">
          คำขอเปลี่ยนบัญชีธนาคารกำลังรอผู้จัดการอนุมัติ
        </p>
      </div>
    );
  }

  function submit() {
    setError(null);
    const v = validateBankChange({ bankName, accountNo, accountName });
    if (v) {
      setError(v);
      return;
    }
    if (!photo) {
      setError("กรุณาแนบรูปสมุดบัญชีของบัญชีใหม่");
      return;
    }
    const file = photo;
    startTransition(async () => {
      const prepared = await preparePhotoForUpload(file);
      if (!prepared) {
        setError("ไฟล์นี้ไม่รองรับ กรุณาเลือกรูปภาพ (JPEG, PNG, WebP, HEIC)");
        return;
      }
      const attachmentId = crypto.randomUUID();
      const path = buildTechnicianDocPath(uid, "book_bank", attachmentId, prepared.ext);
      if (!path) {
        setError("ส่งเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(CONTACT_DOCS_BUCKET)
        .upload(path, prepared.blob, {
          upsert: false,
          contentType: photoExtToMime(prepared.ext),
        });
      if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
        setError("ส่งเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      const result = await submitWorkerBankChange({
        bankName,
        accountNo,
        accountName,
        attachmentId,
        ext: prepared.ext,
        revalidate: "/technician",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("ส่งคำขอแล้ว รอผู้จัดการอนุมัติ");
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">แจ้งเปลี่ยนบัญชีธนาคาร</p>
      <p className="text-ink-muted mt-0.5 text-xs">ผู้จัดการจะตรวจสอบก่อนใช้งานจริง</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อธนาคาร
        <input
          value={bankName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setBankName(e.target.value);
            setError(null);
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เลขที่บัญชี
        <input
          value={accountNo}
          maxLength={50}
          inputMode="numeric"
          disabled={pending}
          onChange={(e) => setAccountNo(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อบัญชี
        <input
          value={accountName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => setAccountName(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>

      {/* Spec 315 U2 — required passbook evidence for the new account. */}
      <p className="text-ink-secondary mt-3 text-sm">
        รูปสมุดบัญชี
        <span className="text-attn-ink ml-1.5 text-xs font-normal">(จำเป็น)</span>
      </p>
      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_ACCEPT_MIME}
        className="sr-only"
        disabled={pending}
        onChange={(e) => {
          setPhoto(e.target.files?.[0] ?? null);
          setError(null);
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => fileRef.current?.click()}
        className={`mt-1.5 w-full ${BUTTON_SECONDARY_MUTED}`}
      >
        {photo ? `เลือกแล้ว: ${photo.name}` : "แนบรูปสมุดบัญชี"}
      </button>

      {error ? (
        <p role="alert" className={`mt-3 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className={`mt-4 w-full ${BUTTON_PRIMARY}`}
      >
        {pending ? "กำลังส่ง…" : "ส่งคำขอเปลี่ยนบัญชี"}
      </button>
    </div>
  );
}
