// Spec 186 U1 — the contractor bank-change approval queue. The aggregate view
// behind the dashboard's bank-change awareness card: every pending change in one
// place with an inline approve/reject, instead of hunting through the contractor
// list. Bank fields are money (zero authenticated grant) → admin-read behind the
// requireRole gate, exactly like the contractor detail page.
//
// DC edit matrix (2026-07-13): the gate widens to PM_ROLES + procurement_manager so
// procurement_manager can approve WORKER bank changes (it owns ช่าง onboarding) —
// matching the widened decide_worker_bank_change RPC. CONTRACTOR deciders stay
// pm/super/director (decideBankChange + its RPC unchanged), so a procurement_manager
// sees contractor rows here too but a contractor decide returns 42501 (the RPC
// refuses). Plain procurement remains excluded from the page entirely.

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { BankChangeDecision } from "@/components/features/portal/bank-change-decision";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES, STAFF_APPROVAL_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import {
  buildBankChangeQueue,
  buildIdentityChangeQueue,
  buildWorkerBankChangeQueue,
} from "@/lib/approvals/bank-change-queue";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { formatThaiDate, formatThaiDateTime } from "@/lib/i18n/labels";

export const metadata = { title: "การเปลี่ยนข้อมูลรอการอนุมัติ" };

const REVALIDATE = "/contacts/bank-changes";

export default async function BankChangeQueuePage() {
  const ctx = await requireRole([...PM_ROLES, "procurement_manager"]);
  const admin = createAdminSupabase();
  // Spec 317 U3 — identity requests carry national-ID PII and are decided by the
  // staff-approval trio ONLY. The page reads via the admin client, so this gate
  // mirrors the table's RLS staff arm: a project_manager (page viewer for the
  // bank kinds) must never see the identity rows.
  const canSeeIdentity = STAFF_APPROVAL_ROLES.includes(ctx.role);

  // All pending changes at once: contractor bank (→ contact_bank), worker bank
  // (→ workers.bank_*, spec 170 U4c-2) and identity changes (spec 317 U3 —
  // name / national ID / DOB, decided by STAFF_APPROVAL_ROLES). Money + PII →
  // admin-read behind the PM gate for all three.
  const [{ data: requests }, { data: workerRequests }, { data: identityRequests }] =
    await Promise.all([
      admin
        .from("contractor_bank_change_requests")
        .select("id, contractor_id, bank_name, bank_account_no, bank_account_name, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      admin
        .from("worker_bank_change_requests")
        .select(
          "id, worker_id, bank_name, bank_account_number, bank_account_name, book_bank_path, created_at",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      canSeeIdentity
        ? admin
            .from("identity_change_requests")
            .select(
              "id, user_id, proposed_full_name, proposed_national_id, proposed_dob, created_at",
            )
            .eq("status", "pending")
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);
  const rows = requests ?? [];
  const workerRows = workerRequests ?? [];
  const identityRows = identityRequests ?? [];

  const contractorIds = Array.from(new Set(rows.map((r) => r.contractor_id)));
  const { data: contractors } = contractorIds.length
    ? await admin.from("contractors").select("id, name").in("id", contractorIds)
    : { data: [] };
  const namesById = new Map((contractors ?? []).map((c) => [c.id, c.name]));

  const workerIds = Array.from(new Set(workerRows.map((r) => r.worker_id)));
  const { data: workers } = workerIds.length
    ? await admin.from("workers").select("id, name").in("id", workerIds)
    : { data: [] };
  const workerNamesById = new Map((workers ?? []).map((w) => [w.id, w.name]));

  // The identity requester's CURRENT name — what the proposed change moves away from.
  const requesterNames = await fetchDisplayNames(
    identityRows.map((r) => r.user_id),
    "bank-changes-queue",
  );

  // Merge all kinds into one oldest-first queue (the awareness arc's "one place").
  const items = [
    ...buildBankChangeQueue(rows, namesById),
    ...buildWorkerBankChangeQueue(workerRows, workerNamesById),
    ...buildIdentityChangeQueue(identityRows, requesterNames),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Spec 315 U2 — sign the worker requests' passbook photos so the approver can
  // verify the typed account number against the evidence. The storage read policy
  // is owner-only, so signing rides the admin client behind the same requireRole
  // gate as the bank fields themselves (the spec-296-U3 exposure model).
  const photoPaths = items.flatMap((it) =>
    it.kind !== "identity" && it.bookBankPath ? [it.bookBankPath] : [],
  );
  const photoUrlByPath = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signed } = await admin.storage
      .from(CONTACT_DOCS_BUCKET)
      .createSignedUrls(photoPaths, 120);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl && !s.error) photoUrlByPath.set(s.path, s.signedUrl);
    }
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/dashboard" backLabel="กลับไปหน้าภาพรวม">
        <h1 className="text-ink text-xl font-semibold tracking-tight">
          การเปลี่ยนข้อมูลรอการอนุมัติ
        </h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {items.length === 0 ? (
          <EmptyNotice>ไม่มีรายการรอการอนุมัติ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((it) => (
              <li
                key={`${it.kind}-${it.id}`}
                className="rounded-card border-edge bg-card shadow-card border p-4"
              >
                <div className="flex items-center gap-2">
                  <p className="text-ink text-base font-semibold break-words">{it.name}</p>
                  <span className="text-ink-muted bg-sunk shrink-0 rounded-full px-2 py-0.5 text-xs">
                    {it.kind === "identity"
                      ? "ข้อมูลตัวตน"
                      : it.kind === "worker"
                        ? "ทีมงาน"
                        : "ผู้รับเหมา"}
                  </span>
                </div>
                {it.kind === "identity" ? (
                  // Spec 317 U3 — proposed identity fields; only non-null rows show.
                  <dl className="text-ink-secondary mt-2 space-y-0.5 text-sm">
                    {it.proposedFullName ? (
                      <div className="flex gap-2">
                        <dt className="text-ink-muted w-24 shrink-0">ชื่อใหม่</dt>
                        <dd>{it.proposedFullName}</dd>
                      </div>
                    ) : null}
                    {it.proposedNationalId ? (
                      <div className="flex gap-2">
                        <dt className="text-ink-muted w-24 shrink-0">เลขบัตรใหม่</dt>
                        <dd className="font-mono">{it.proposedNationalId}</dd>
                      </div>
                    ) : null}
                    {it.proposedDob ? (
                      <div className="flex gap-2">
                        <dt className="text-ink-muted w-24 shrink-0">วันเกิดใหม่</dt>
                        <dd>{formatThaiDate(it.proposedDob)}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <>
                    <dl className="text-ink-secondary mt-2 space-y-0.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="text-ink-muted w-20 shrink-0">ธนาคาร</dt>
                        <dd>{it.bankName ?? "—"}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-ink-muted w-20 shrink-0">ชื่อบัญชี</dt>
                        <dd>{it.accountName ?? "—"}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-ink-muted w-20 shrink-0">เลขบัญชี</dt>
                        <dd className="font-mono">{it.accountNo ?? "—"}</dd>
                      </div>
                    </dl>
                    {it.bookBankPath ? (
                      photoUrlByPath.get(it.bookBankPath) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photoUrlByPath.get(it.bookBankPath)}
                          alt="รูปสมุดบัญชี"
                          className="border-edge rounded-control mt-2 h-40 w-full border object-contain"
                        />
                      ) : (
                        // A photo was declared but can't be signed — surface it loudly
                        // so a broken/dangling photo never reads like a legacy no-photo
                        // row (the approver's verify-against-passbook gate depends on it).
                        <p className="text-attn-ink mt-2 text-sm font-medium">
                          แนบรูปสมุดบัญชีไว้แต่เปิดไม่ได้ — ตรวจสอบก่อนอนุมัติ
                        </p>
                      )
                    ) : null}
                  </>
                )}
                <p className="text-ink-muted mt-2 text-xs">
                  ส่งคำขอเมื่อ {formatThaiDateTime(it.createdAt)}
                </p>
                <div className="mt-3">
                  <BankChangeDecision requestId={it.id} kind={it.kind} revalidate={REVALIDATE} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
