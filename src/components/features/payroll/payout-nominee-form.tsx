"use client";

// Spec 320 U2 — the PM records a TEMPORARY payout nominee (a friend/family bank
// account) for a bankless worker. Signed-consent photo REQUIRED — uploaded to
// the PM-scoped nominee-consent/<workerId>/ path (the action rebuilds the path
// from workerId + attachmentId + ext, never trusting a client path). Submitting
// with an existing nominee replaces it (the RPC clears the prior active row).
// 'use client': form state + consent upload + the server-action call.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPayoutNominee } from "@/app/settings/payout-nominees/actions";
import { BankSelect } from "@/components/features/common/bank-select";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { buildNomineeConsentPath } from "@/lib/payroll/payout-nominee-path";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import {
  PAYOUT_NOMINEE_CONSENT_REQUIRED,
  PAYOUT_NOMINEE_PROMPTPAY_HINT,
  PAYOUT_NOMINEE_SUBMIT,
} from "@/lib/i18n/labels";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  CARD,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

export interface PayoutNomineeInitial {
  payeeName: string;
  relationship: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

const NOMINEES_PATH = "/settings/payout-nominees";

export function PayoutNomineeForm({
  workerId,
  initial,
}: {
  workerId: string;
  initial: PayoutNomineeInitial | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [payeeName, setPayeeName] = useState(initial?.payeeName ?? "");
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [accountNo, setAccountNo] = useState(initial?.accountNumber ?? "");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    setError(null);
    if (
      !payeeName.trim() ||
      !relationship.trim() ||
      !bankName.trim() ||
      !accountNo.trim() ||
      !accountName.trim()
    ) {
      setError("กรุณากรอกข้อมูลผู้รับเงินให้ครบ");
      return;
    }
    if (!/^[0-9]{6,20}$/.test(accountNo.replace(/[\s-]/g, ""))) {
      setError("เลขที่บัญชีไม่ถูกต้อง (ตัวเลข 6-20 หลัก)");
      return;
    }
    if (!photo) {
      setError(PAYOUT_NOMINEE_CONSENT_REQUIRED);
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
      const path = buildNomineeConsentPath(workerId, attachmentId, prepared.ext);
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

      const result = await setPayoutNominee({
        workerId,
        payeeName,
        relationship,
        bankName,
        accountNo,
        accountName,
        attachmentId,
        ext: prepared.ext,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกบัญชีตัวแทนแล้ว");
      router.push(NOMINEES_PATH);
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <p className="text-ink-muted text-xs">{PAYOUT_NOMINEE_PROMPTPAY_HINT}</p>

      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อผู้รับเงิน (เจ้าของบัญชี)
        <input
          value={payeeName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => setPayeeName(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ความสัมพันธ์กับช่าง
        <input
          value={relationship}
          maxLength={60}
          disabled={pending}
          placeholder="เช่น พี่ชาย, คู่สมรส"
          onChange={(e) => setRelationship(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>

      <p className="text-ink-secondary mt-3 text-sm">ชื่อธนาคาร</p>
      <BankSelect
        value={bankName}
        disabled={pending}
        onChange={(name) => {
          setBankName(name);
          setError(null);
        }}
      />
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

      <p className="text-ink-secondary mt-3 text-sm">
        รูปหนังสือยินยอมให้โอนเข้าบัญชีตัวแทน
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
        {photo ? `เลือกแล้ว: ${photo.name}` : "แนบรูปหนังสือยินยอม"}
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
        {pending ? "กำลังบันทึก…" : PAYOUT_NOMINEE_SUBMIT}
      </button>
    </div>
  );
}
