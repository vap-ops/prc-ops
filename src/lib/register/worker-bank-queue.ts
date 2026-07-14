import "server-only";

// Spec 298 U3 — the PM completion queue reader. worker_bank_capture is zero-grant
// (service_role only) and the SA-captured passbook lives in the walled sa-bank-capture/
// store (no authenticated SELECT), so this ONE read uses the service-role admin client
// — the same exposure model as admin-registration-bank (296 U3): the page already
// passed requireRole(STAFF_APPROVAL_ROLES), and the admin client only surfaces the
// pending captures a money-authorized approver may complete. Returns worker identity +
// a short-lived SIGNED passbook URL (never the raw path) so the PM can transcribe the
// bank into workers.bank_* via complete_worker_bank.

import { createClient as createAdminClient } from "@/lib/db/admin";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export interface AwaitingBankRow {
  workerId: string;
  name: string;
  employeeId: string | null;
  photoUrl: string | null;
}

export async function listWorkersAwaitingBank(): Promise<AwaitingBankRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("worker_bank_capture")
    .select("worker_id, photo_path, workers(name, employee_id)")
    .eq("status", "pending_pm")
    .order("captured_at", { ascending: true });

  const rows = (data ?? []) as {
    worker_id: string;
    photo_path: string;
    workers:
      | { name: string; employee_id: string | null }
      | { name: string; employee_id: string | null }[]
      | null;
  }[];

  return Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await admin.storage
        .from(CONTACT_DOCS_BUCKET)
        .createSignedUrl(r.photo_path, SIGNED_URL_TTL_SECONDS);
      const w = Array.isArray(r.workers) ? r.workers[0] : r.workers;
      return {
        workerId: r.worker_id,
        name: w?.name ?? "",
        employeeId: w?.employee_id ?? null,
        photoUrl: signed?.signedUrl ?? null,
      };
    }),
  );
}
