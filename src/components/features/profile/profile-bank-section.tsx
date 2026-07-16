"use client";

// Spec 321 U2 — ProfileBankSection: the ONE bank-change surface for every
// audience (worker / contractor / staff / user), replacing 4 near-identical
// clone forms (S10). Detail/home pages stay read-only (operator rule, decision
// 6): this renders the current bank as a read card + an แก้ไข control that opens
// a BottomSheet hosting the shared change form. Per-audience differences
// (passbook path, accountName cap, approver copy) come from BANK_AUDIENCE; the
// submit is dispatched server-side. Submit body is ported verbatim from the
// former clones so behavior is unchanged.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BankSelect } from "@/components/features/common/bank-select";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { createClient } from "@/lib/db/browser";
import { validateBankChange } from "@/lib/portal/bank-change";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { useToast } from "@/lib/ui/use-toast";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  CARD,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";
import { BANK_AUDIENCE, type BankAudience } from "@/lib/profile/bank-audience";
import { submitProfileBankChange } from "@/lib/profile/submit-profile-bank-change";
import { PendingChangeNotice } from "@/components/features/profile/pending-change-notice";

interface CurrentBank {
  bankName: string;
  accountNo: string;
  accountName: string;
}

export function ProfileBankSection({
  audience,
  ownerId,
  current,
  showEmptyState = false,
  hasPending,
}: {
  audience: BankAudience;
  ownerId: string;
  // The current bank (read card), or null when there is none / it was not
  // loaded on this surface.
  current: CurrentBank | null;
  // When true AND current is null, render the "ยังไม่มีบัญชีธนาคาร" line. Off
  // by default so a surface that never loads the current bank (or never showed
  // an empty notice) makes no false "no bank" claim — matches each clone's
  // prior behavior (worker showed the notice; staff/contractor did not).
  showEmptyState?: boolean;
  hasPending: boolean;
}) {
  const cfg = BANK_AUDIENCE[audience];
  // Spec 321 U8a — instant tier (user_bank) saves directly: no pending banner,
  // "บันทึก" instead of "ส่งคำขอ".
  const instant = cfg.tierMode === "instant";
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [bankName, setBankName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [accountName, setAccountName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      const path = cfg.buildPhotoPath(ownerId, attachmentId, prepared.ext);
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

      const result = await submitProfileBankChange(audience, {
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
      toast.success(cfg.successToast);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      {current ? (
        <>
          <p className="text-ink text-sm font-medium">{current.bankName}</p>
          <p className="text-ink text-sm">
            {current.accountNo}
            {current.accountName ? ` · ${current.accountName}` : ""}
          </p>
        </>
      ) : showEmptyState ? (
        <p className="text-ink-secondary text-sm">ยังไม่มีบัญชีธนาคาร</p>
      ) : null}

      {!instant && hasPending ? (
        <PendingChangeNotice className="mt-3 rounded-md px-3 py-2">
          {cfg.pendingText}
        </PendingChangeNotice>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`mt-3 w-full ${BUTTON_SECONDARY_MUTED}`}
        >
          แก้ไข
        </button>
      )}

      <BottomSheet open={open} onClose={() => setOpen(false)} title="แจ้งเปลี่ยนบัญชีธนาคาร">
        <p className="text-ink-muted text-xs">{cfg.subtitle}</p>
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
            maxLength={cfg.accountNameMax}
            disabled={pending}
            onChange={(e) => setAccountName(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>

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
          {instant
            ? pending
              ? "กำลังบันทึก…"
              : "บันทึก"
            : pending
              ? "กำลังส่ง…"
              : "ส่งคำขอเปลี่ยนบัญชี"}
        </button>
      </BottomSheet>
    </div>
  );
}
