"use client";

// Spec 333 U2 — the post-approval docs-owed view for a DEFERRED-DOCS office
// approval (mig 075822): the account already works, but the approval deferred
// the document floors, so the workspace shows exactly what is still owed —
// upload rows for the missing attachments (the add_staff_registration_doc
// carve accepts id_card on any approved row and book_bank while deferred) and
// the bank mini-form (record_own_staff_bank's deferred carve) — plus the way
// out to the applicant's real home. Rendered by StaffRegisterWorkspace ONLY
// while deferredDocsOwed() is non-empty; once complete the workspace redirects
// to roleHome exactly as before (mode F6 self-heals).
//
// 'use client' justified: the file-input upload flow (DocRow) and the bank
// field state both need client interactivity.

import { useState } from "react";
import Link from "next/link";
import { CARD } from "@/lib/ui/classes";
import type { OwedDoc } from "@/lib/register/docs-owed";
import type { StaffDocPurpose } from "@/lib/register/document-types";
import { DocRow, StaffBankFields } from "./staff-registration-form";

export function DocsOwedCard({
  uid,
  owed,
  docUrls,
  homeHref,
  initialBank,
}: {
  uid: string;
  owed: readonly OwedDoc[];
  docUrls: Partial<Record<StaffDocPurpose, string>>;
  homeHref: string;
  initialBank: { bankName: string; accountNumber: string; accountName: string } | null;
}) {
  const [bankName, setBankName] = useState(initialBank?.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(initialBank?.accountNumber ?? "");
  const [accountName, setAccountName] = useState(initialBank?.accountName ?? "");

  const owedAttachments = owed.filter(
    (o): o is Extract<OwedDoc, StaffDocPurpose> => o === "id_card" || o === "book_bank",
  );

  return (
    <div className={CARD}>
      <p className="text-ink text-base font-semibold">เอกสารที่ต้องส่งเพิ่ม</p>
      <p className="text-ink-muted mt-1 text-sm">
        บัญชีของท่านได้รับอนุมัติและใช้งานได้แล้ว แต่ยังขาดเอกสารด้านล่าง กรุณาส่งให้ครบเมื่อสะดวก
      </p>
      <Link
        href={homeHref}
        className="text-action focus-visible:ring-action mt-2 inline-flex items-center gap-1 self-start rounded-md text-sm font-medium focus:outline-none focus-visible:ring-2"
      >
        ไปหน้าหลัก
      </Link>
      <div className="mt-4 flex flex-col gap-4">
        {owedAttachments.map((purpose) => (
          <DocRow key={purpose} uid={uid} purpose={purpose} currentUrl={docUrls[purpose] ?? null} />
        ))}
        {owed.includes("bank_fields") ? (
          <StaffBankFields
            bankName={bankName}
            accountNumber={accountNumber}
            accountName={accountName}
            setBankName={setBankName}
            setAccountNumber={setAccountNumber}
            setAccountName={setAccountName}
            saved={false}
          />
        ) : null}
      </div>
    </div>
  );
}
