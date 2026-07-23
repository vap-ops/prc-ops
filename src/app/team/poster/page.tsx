// Spec 328 U2 — printable per-firm onboarding poster. One BIG QR for a single
// (contractor × project) pair so the SA can pin it at the site office / morning-
// talk board and a firm's members self-onboard by scanning the wall instead of
// the SA's phone. Same URL family as the sheet's firm QR (advisory ?contractor +
// display ?firm — the approver confirms the binding firm, F2b trust rule).
// Print-first like /team/badges: chrome hidden under print:hidden.
import QRCode from "qrcode";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { clientEnv } from "@/lib/env";
import { technicianOnboardUrl } from "@/lib/register/onboard-link";
import { isValidUuid } from "@/lib/validate/uuid";
import {
  SUBCON_JOIN_PREFIX,
  SUBCON_NO_BANK_HINT,
  REGISTER_PREP_POSTER_LINE,
} from "@/lib/i18n/labels";

export const metadata = { title: "โปสเตอร์สมัครทีมผู้รับเหมา" };

export default async function SubconPosterPage({
  searchParams,
}: {
  searchParams: Promise<{ contractor?: string; project?: string }>;
}) {
  const gate = await requireRole(["site_admin", "super_admin"]);
  const { contractor, project } = await searchParams;
  const contractorId = isValidUuid(contractor) ? contractor : null;
  const projectId = isValidUuid(project) ? project : null;
  const supabase = await createClient();

  // Both reads are RLS-scoped (contractors: privileged-roles policy; projects:
  // visibility policy) — a forged id simply resolves to nothing.
  const [firmRes, projectRes] = await Promise.all([
    contractorId
      ? supabase.from("contractors").select("id, name").eq("id", contractorId).maybeSingle()
      : Promise.resolve({ data: null }),
    projectId
      ? supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const firm = firmRes.data;
  const proj = projectRes.data;

  let svg: string | null = null;
  let url: string | null = null;
  if (firm && proj) {
    url = technicianOnboardUrl(clientEnv.NEXT_PUBLIC_APP_URL, {
      projectId: proj.id,
      siteLabel: proj.name,
      inviterId: gate.id,
      contractorId: firm.id,
      firmLabel: firm.name,
    });
    svg = await QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: 320,
      color: { dark: "#000000", light: "#ffffff" },
    });
  }

  return (
    <PageShell>
      <div className="print:hidden">
        <DetailHeader backHref="/team" backLabel="กลับ">
          <h1 className={DETAIL_TITLE}>โปสเตอร์สมัครทีมผู้รับเหมา</h1>
        </DetailHeader>
      </div>
      <section
        className={`mx-auto ${PAGE_MAX_W} flex flex-col items-center gap-4 px-5 py-6 print:bg-white print:p-0`}
      >
        {firm && proj && svg ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-white p-6 text-center print:rounded-none">
            <p className="text-2xl font-bold break-words text-black">
              {SUBCON_JOIN_PREFIX} {firm.name}
            </p>
            <p className="text-lg break-words text-black">{proj.name}</p>
            <div
              aria-label={`QR ${SUBCON_JOIN_PREFIX} ${firm.name} — ${proj.name}`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="text-base text-black">สแกนด้วยมือถือของท่านเพื่อสมัครเข้าทีม</p>
            {/* Spec 343 U3 — tell them what to bring before they scan the wall. */}
            <p className="text-base font-semibold text-black">{REGISTER_PREP_POSTER_LINE}</p>
            <p className="text-sm text-black">{SUBCON_NO_BANK_HINT}</p>
          </div>
        ) : (
          <p className="text-ink-muted text-sm">ไม่พบทีมหรือโครงการที่ระบุ</p>
        )}
      </section>
    </PageShell>
  );
}
