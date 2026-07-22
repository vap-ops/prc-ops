"use client";

// Spec 264 G2 — the ONE-PAGE self-service staff registration form. Consolidates
// the former StartRegistrationForm + RegistrationForm + RegistrationDocuments
// (spec 263 U2) into a single cohesive card: identity fields + document uploads
// + the PDPA consent checkbox, all editable together, per the operator's
// directive ("let them input ALL information at the registration page,
// including document uploads" — spec doc §"One-page self-service form").
//
// Two renders of the SAME markup:
//   - no registration yet: only full_name + phone are meaningfully required
//     (the rest are present but save is deferred until a registration exists);
//     the first "บันทึก" calls startStaffRegistration, minting the employee_id
//     + row, then the page (via router.refresh()) re-renders this same
//     component in "pending" mode with everything editable.
//   - registration exists (pending): full_name/phone/dob/emergency all save via
//     updateOwnStaffRegistration; doc rows upload via addStaffRegistrationDoc;
//     the consent checkbox records via recordOwnStaffConsent. All optional
//     beyond full_name — self-service, not forced (spec doc §"Fields").
//
// 'use client' justified: multi-field form state, per-doc upload state machine,
// consent-checkbox pending state, and several server-action calls — this is the
// entire interactive surface of the page; splitting it into server/client
// slices would only fragment one cohesive save flow.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startStaffRegistration,
  updateOwnStaffRegistration,
  addStaffRegistrationDoc,
  recordOwnStaffConsent,
  recordOwnStaffBank,
} from "@/lib/register/actions";
import { validateRegistrationProfile } from "@/lib/register/registration-profile";
import { validateRegistrationBank } from "@/lib/register/registration-bank";
import { registrationApprovalFloor } from "@/lib/register/registration-floor";
import { createClient } from "@/lib/db/browser";
import { PHOTO_ACCEPT_MIME, photoExtToMime } from "@/lib/photos/path";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { buildTechnicianDocPath } from "@/lib/register/technician-path";
import { BankSelect } from "@/components/features/common/bank-select";
import {
  STAFF_DOC_PURPOSES,
  STAFF_DOC_LABELS,
  type StaffDocPurpose,
} from "@/lib/register/document-types";
import { useToast } from "@/lib/ui/use-toast";
import { formatThaiDate, INVITED_ROLE_LABEL, USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/auth/role-home";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  CARD,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";

export interface StaffRegistrationFormInitial {
  fullName: string;
  phone: string;
  dob: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
  declaredRoleHint: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface StaffRegistrationFormProps {
  /** null → no registration yet (first save mints it). */
  registrationExists: boolean;
  initial: StaffRegistrationFormInitial;
  /** Present only once a registration exists (doc uploads need an owner uid). */
  uid: string | null;
  docUrls: Partial<Record<StaffDocPurpose, string>>;
  consentedAt: string | null;
  /** Spec 279 F2b — the SA's per-project QR params (?by / ?project), forwarded to
   *  the mint so the approver later sees เชิญโดย + the pre-filled site. Advisory:
   *  the action UUID-gates them and the RPC existence-coerces. Mint-time only. */
  invitedBy?: string | null;
  invitedProjectId?: string | null;
  /** Spec 328 — the per-firm subcon QR's ?contractor (mint-time, advisory). */
  invitedContractorId?: string | null;
  /** Spec 328 — subcon members are pay-exempt: hide the declared-bank fields +
   *  the book_bank upload and drop both from the approval floor (mirrors the
   *  approve RPC's contractor arm). Fresh form: from the QR param; pending form:
   *  from the registration row's invited_contractor_id. */
  bankExempt?: boolean;
  /** Spec 342 D2 — the invite link's role (or the pending row's parsed
   *  declared_role_hint). Non-null → the role renders as read-only fact and
   *  the free-text hint input does not render. The submitted
   *  declaredRoleHint still comes from `initial` (the workspace seeds it with
   *  the role key), so the mint writes it — spec U2.4. */
  invitedRole?: UserRole | null;
}

export function StaffRegistrationForm({
  registrationExists,
  initial,
  uid,
  docUrls,
  consentedAt,
  invitedBy = null,
  invitedProjectId = null,
  invitedContractorId = null,
  bankExempt = false,
  invitedRole = null,
}: StaffRegistrationFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone);
  const [dob, setDob] = useState(initial.dob);
  const [emergencyName, setEmergencyName] = useState(initial.emergencyName);
  const [emergencyRelation, setEmergencyRelation] = useState(initial.emergencyRelation);
  const [emergencyPhone, setEmergencyPhone] = useState(initial.emergencyPhone);
  const [declaredRoleHint, setDeclaredRoleHint] = useState(initial.declaredRoleHint);
  const [bankName, setBankName] = useState(initial.bankName);
  const [accountNumber, setAccountNumber] = useState(initial.accountNumber);
  const [accountName, setAccountName] = useState(initial.accountName);
  const [error, setError] = useState<string | null>(null);

  // hasBankFields mirrors the OTHER floor inputs (docUrls / consentedAt): it reflects
  // the PERSISTED bank (from `initial`, refreshed by router.refresh() after a save),
  // NOT the unsaved typed state — so typing without pressing "บันทึกบัญชีธนาคาร" does
  // not falsely satisfy the floor while the DB still has no staff_registration_bank row.
  const bankSaved =
    validateRegistrationBank({
      bankName: initial.bankName,
      accountNumber: initial.accountNumber,
      accountName: initial.accountName,
    }) === null;

  const floor = registrationApprovalFloor({
    fullName,
    hasIdCard: Boolean(docUrls.id_card),
    hasBookBank: Boolean(docUrls.book_bank),
    hasBankFields: bankSaved,
    hasConsent: Boolean(consentedAt),
    bankExempt,
  });

  function clear() {
    setError(null);
  }

  function submit() {
    setError(null);
    const payload = { fullName, phone, dob, emergencyName, emergencyRelation, emergencyPhone };
    if (!registrationExists && !fullName.trim()) {
      setError("กรุณาระบุชื่อ-นามสกุล");
      return;
    }
    const v = validateRegistrationProfile(payload);
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = registrationExists
        ? await updateOwnStaffRegistration({ ...payload, declaredRoleHint })
        : await startStaffRegistration({
            fullName,
            phone,
            declaredRoleHint,
            ...(invitedBy ? { invitedBy } : {}),
            ...(invitedProjectId ? { invitedProjectId } : {}),
            ...(invitedContractorId ? { invitedContractorId } : {}),
          });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">ข้อมูลของฉัน</p>
      <label className="text-ink-secondary mt-3 block text-sm">
        ชื่อ-นามสกุล
        <input
          value={fullName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setFullName(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เบอร์โทร
        <input
          value={phone}
          maxLength={50}
          inputMode="tel"
          disabled={pending}
          onChange={(e) => {
            setPhone(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        วันเกิด
        <input
          type="date"
          value={dob}
          disabled={pending}
          onChange={(e) => {
            setDob(e.target.value);
            clear();
          }}
          className={`${FIELD_STACKED} appearance-none`}
        />
      </label>
      {invitedRole ? (
        <div className="mt-3">
          <p className="text-ink-secondary text-sm">{INVITED_ROLE_LABEL}</p>
          <p className="text-ink mt-0.5 text-base font-semibold">{USER_ROLE_LABEL[invitedRole]}</p>
        </div>
      ) : (
        <label className="text-ink-secondary mt-3 block text-sm">
          คาดว่าจะทำงานตำแหน่งใด (ไม่บังคับ)
          <input
            value={declaredRoleHint}
            maxLength={120}
            disabled={pending}
            placeholder="เช่น ช่างเทคนิค, จัดซื้อ"
            onChange={(e) => {
              setDeclaredRoleHint(e.target.value);
              clear();
            }}
            className={FIELD_STACKED}
          />
        </label>
      )}

      <p className="text-ink mt-4 text-sm font-semibold">ผู้ติดต่อฉุกเฉิน (ไม่บังคับ)</p>
      <label className="text-ink-secondary mt-2 block text-sm">
        ชื่อ
        <input
          value={emergencyName}
          maxLength={120}
          disabled={pending}
          onChange={(e) => {
            setEmergencyName(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        ความสัมพันธ์
        <input
          value={emergencyRelation}
          maxLength={60}
          disabled={pending}
          onChange={(e) => {
            setEmergencyRelation(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-3 block text-sm">
        เบอร์โทรฉุกเฉิน
        <input
          value={emergencyPhone}
          maxLength={50}
          inputMode="tel"
          disabled={pending}
          onChange={(e) => {
            setEmergencyPhone(e.target.value);
            clear();
          }}
          className={FIELD_STACKED}
        />
      </label>

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
        {pending ? "กำลังบันทึก…" : registrationExists ? "บันทึก" : "เริ่มสมัคร"}
      </button>

      {registrationExists && uid ? (
        <>
          <hr className="border-edge my-4" />
          <StaffDocuments uid={uid} urls={docUrls} bankExempt={bankExempt} />
          {!bankExempt ? (
            <>
              <hr className="border-edge my-4" />
              <StaffBankFields
                bankName={bankName}
                accountNumber={accountNumber}
                accountName={accountName}
                setBankName={setBankName}
                setAccountNumber={setAccountNumber}
                setAccountName={setAccountName}
                saved={bankSaved}
              />
            </>
          ) : null}
          <hr className="border-edge my-4" />
          <StaffConsentCheckbox
            consentedAt={consentedAt}
            floorMet={floor.met}
            bankExempt={bankExempt}
          />
        </>
      ) : (
        <p className="text-ink-muted mt-3 text-xs">
          กด &quot;เริ่มสมัคร&quot; เพื่อรับรหัสพนักงาน
          จากนั้นจะสามารถอัปโหลดเอกสารและให้ความยินยอมได้ในหน้าเดียวกันนี้
        </p>
      )}
    </div>
  );
}

type UploadPhase = "idle" | "uploading" | "saving" | "error";

function StaffDocuments({
  uid,
  urls,
  bankExempt = false,
}: {
  uid: string;
  urls: Partial<Record<StaffDocPurpose, string>>;
  /** Spec 328 — subcon members never upload a passbook (no bank collected). */
  bankExempt?: boolean;
}) {
  const purposes = STAFF_DOC_PURPOSES.filter((p) => !(bankExempt && p === "book_bank"));
  return (
    <div>
      <p className="text-ink text-sm font-semibold">เอกสาร</p>
      <p className="text-ink-muted mt-0.5 text-xs">
        อัปโหลดเอกสารของท่าน เฉพาะบริษัทและท่านเท่านั้นที่เห็น
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {purposes.map((purpose) => (
          <DocRow key={purpose} uid={uid} purpose={purpose} currentUrl={urls[purpose] ?? null} />
        ))}
      </div>
    </div>
  );
}

// Exported for spec 333's DocsOwedCard (post-approval deferred-docs uploads) —
// the same upload flow, hosted outside this form.
export function DocRow({
  uid,
  purpose,
  currentUrl,
}: {
  uid: string;
  purpose: StaffDocPurpose;
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
    let result: Awaited<ReturnType<typeof addStaffRegistrationDoc>>;
    try {
      result = await addStaffRegistrationDoc({ purpose, attachmentId, ext });
    } catch (err) {
      console.error("[staff-registration-form] doc action invocation failed", err);
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
  const required = purpose === "id_card" || purpose === "book_bank";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink text-sm font-medium">
        {STAFF_DOC_LABELS[purpose]}
        {required ? (
          <span className="text-attn-ink ml-1.5 text-xs font-normal">(จำเป็นสำหรับการอนุมัติ)</span>
        ) : (
          <span className="text-ink-muted ml-1.5 text-xs font-normal">(ไม่บังคับ)</span>
        )}
      </p>
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentUrl}
          alt={STAFF_DOC_LABELS[purpose]}
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

// Spec 296 — the applicant's declared bank fields. Stored in the zero-grant
// staff_registration_bank via recordOwnStaffBank (own + pending). The parent owns
// the values (they drive the approval-floor `hasBankFields`); this child renders
// the inputs and handles the save. Exported for spec 333's DocsOwedCard
// (post-approval deferred bank details) — the save RPC carries the carve.
export function StaffBankFields({
  bankName,
  accountNumber,
  accountName,
  setBankName,
  setAccountNumber,
  setAccountName,
  saved,
}: {
  bankName: string;
  accountNumber: string;
  accountName: string;
  setBankName: (v: string) => void;
  setAccountNumber: (v: string) => void;
  setAccountName: (v: string) => void;
  /** True once a bank row is persisted (from `initial`) — drives the floor. */
  saved: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const v = validateRegistrationBank({ bankName, accountNumber, accountName });
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = await recordOwnStaffBank({ bankName, accountNumber, accountName });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกบัญชีธนาคารแล้ว");
      router.refresh();
    });
  }

  return (
    <div>
      <p className="text-ink text-sm font-semibold">
        บัญชีธนาคาร
        <span className="text-attn-ink ml-1.5 text-xs font-normal">(จำเป็นสำหรับการอนุมัติ)</span>
      </p>
      <p className="text-ink-muted mt-0.5 text-xs">
        สำหรับการจ่ายค่าจ้าง เฉพาะบริษัทและท่านเท่านั้นที่เห็น
      </p>
      <p className="text-ink-secondary mt-2 text-sm">ธนาคาร</p>
      <BankSelect value={bankName} disabled={pending} onChange={setBankName} />
      <label className="text-ink-secondary mt-3 block text-sm">
        เลขที่บัญชี
        <input
          value={accountNumber}
          maxLength={30}
          inputMode="numeric"
          disabled={pending}
          onChange={(e) => setAccountNumber(e.target.value)}
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
      {error ? (
        <p role="alert" className={`mt-2 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className={`mt-3 w-full ${BUTTON_SECONDARY_MUTED}`}
      >
        {pending ? "กำลังบันทึก…" : "บันทึกบัญชีธนาคาร"}
      </button>
      {saved ? (
        <p className="text-done-strong mt-1.5 text-xs">✓ บันทึกบัญชีธนาคารแล้ว</p>
      ) : (
        <p className="text-ink-muted mt-1.5 text-xs">
          ยังไม่ได้บันทึก — กด “บันทึกบัญชีธนาคาร” เพื่อบันทึก
        </p>
      )}
    </div>
  );
}

function StaffConsentCheckbox({
  consentedAt,
  floorMet,
  bankExempt = false,
}: {
  consentedAt: string | null;
  floorMet: boolean;
  /** Spec 328 — no bank is collected for a subcon member, so the consent scope
   *  and the floor hint must not claim bank data is. */
  bankExempt?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function tick() {
    if (consentedAt) return; // already recorded — the checkbox is a one-way tick.
    setError(null);
    startTransition(async () => {
      const result = await recordOwnStaffConsent();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("บันทึกความยินยอมแล้ว");
      router.refresh();
    });
  }

  return (
    <div>
      <p className="text-ink text-sm font-semibold">
        ความยินยอม (PDPA)
        <span className="text-attn-ink ml-1.5 text-xs font-normal">(จำเป็นสำหรับการอนุมัติ)</span>
      </p>
      <label className="mt-2 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={Boolean(consentedAt)}
          disabled={pending || Boolean(consentedAt)}
          onChange={tick}
          className="border-edge mt-0.5 h-4 w-4 shrink-0 rounded"
        />
        <span className="text-ink-secondary text-sm">
          ยินยอมตาม PDPA ให้บริษัทเก็บและใช้ข้อมูลส่วนบุคคลของท่านเพื่อการสมัครและว่าจ้างงาน
          {bankExempt ? "" : " รวมถึงข้อมูลบัญชีธนาคารเพื่อการจ่ายค่าจ้าง"}
        </span>
      </label>
      {consentedAt ? (
        <p className="text-done-strong mt-1.5 text-xs">
          ✓ บันทึกความยินยอมแล้ว · {formatThaiDate(consentedAt)}
        </p>
      ) : (
        <p className="text-ink-muted mt-1.5 text-xs">ยังไม่ได้ให้ความยินยอม</p>
      )}
      {error ? (
        <p role="alert" className={`mt-1.5 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
      {/* Spec 343 D3 — was `!floorMet && !consentedAt`: the only line naming what
          is still required vanished the moment consent was ticked, i.e. exactly
          one step from done with an id_card still owed. */}
      {!floorMet ? (
        <p className="text-ink-muted mt-2 text-xs">
          {bankExempt
            ? "ต้องกรอกชื่อ-นามสกุล อัปโหลดบัตรประชาชน และให้ความยินยอมนี้ ก่อนที่จะได้รับการอนุมัติ"
            : "ต้องกรอกชื่อ-นามสกุล อัปโหลดบัตรประชาชน อัปโหลดสมุดบัญชีธนาคาร กรอกบัญชีธนาคาร และให้ความยินยอมนี้ ก่อนที่จะได้รับการอนุมัติ"}
        </p>
      ) : null}
    </div>
  );
}
