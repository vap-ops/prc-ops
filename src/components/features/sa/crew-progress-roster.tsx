// Spec 279 U7 — the /sa/crew roster as a staged onboarding progress tracker.
// The SA can already observe three gates; this surfaces them as steps so the SA
// knows who is stuck where and can chase the follow-up:
//   รอตรวจ  — pending staff_registrations (self-registered, awaiting the SA's
//             review → CTA to /sa/registrations).
//   รอยืนยัน — active workers a PM has not yet cost/level-confirmed
//             (cost_confirmed_at IS NULL): rostered but not cost-loggable.
//   พร้อม   — cost-confirmed workers; level is set, so it shows the level badge.
// Pure presentation — no schema; reuses reads already granted (staff_registrations
// queue, workers.cost_confirmed_at, workers.level). Crew/team grouping + the WP
// label are deferred to the schema-bearing units (spec 279 §8 U5/U6).

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyNotice } from "@/components/features/common/notices";
import { WORKER_LEVEL_LABEL, type WorkerLevel } from "@/lib/nova/dials";
import { BANK_PENDING_CHIP_LABEL } from "@/lib/i18n/labels";

export interface CrewProgressMember {
  id: string;
  name: string;
  /** null until a PM confirms the worker's cost/level. */
  level: WorkerLevel | null;
  /** Shown only when the SA runs more than one project. */
  projectLabel?: string;
  /** Spec 298 U2 — a phoneless SA-added worker awaiting a PM's bank transcription. */
  bankPending?: boolean;
}

export interface CrewProgressData {
  /** Pending staff_registrations — self-registered, awaiting the SA's review. */
  needsReview: { id: string; name: string }[];
  /** Active workers whose pay/level a PM has not confirmed (cost_confirmed_at IS NULL). */
  awaitingConfirm: CrewProgressMember[];
  /** Cost-confirmed workers — payable + cost-loggable; level is set. */
  ready: CrewProgressMember[];
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="bg-sunk text-ink-secondary text-meta shrink-0 rounded-full px-2 py-0.5 font-bold tabular-nums">
      {n}
    </span>
  );
}

function MemberRow({
  name,
  level,
  projectLabel,
  bankPending,
}: {
  name: string;
  level?: WorkerLevel | null;
  projectLabel?: string;
  bankPending?: boolean;
}) {
  return (
    <li className="border-edge text-ink flex min-h-11 items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0">
      <span className="min-w-0 truncate font-medium">{name}</span>
      <span className="flex shrink-0 items-center gap-2">
        {bankPending ? (
          <span className="border-edge bg-sunk text-ink-secondary text-meta rounded-full border px-2 py-0.5">
            {BANK_PENDING_CHIP_LABEL}
          </span>
        ) : null}
        {level ? (
          <span className="border-edge bg-sunk text-ink-secondary text-meta rounded-full border px-2 py-0.5">
            {WORKER_LEVEL_LABEL[level]}
          </span>
        ) : null}
        {projectLabel ? <span className="text-ink-muted text-meta">{projectLabel}</span> : null}
      </span>
    </li>
  );
}

function Gate({
  label,
  hint,
  count,
  children,
}: {
  label: string;
  hint: string;
  count: number;
  children?: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-meta text-ink-secondary font-semibold">{label}</h3>
        <CountBadge n={count} />
        <span className="text-ink-muted text-meta min-w-0 truncate">{hint}</span>
      </div>
      {children}
    </section>
  );
}

export function CrewProgressRoster({
  data,
  registrationsHref,
}: {
  data: CrewProgressData;
  registrationsHref: string;
}) {
  const total = data.needsReview.length + data.awaitingConfirm.length + data.ready.length;

  return (
    <div className="flex flex-col gap-5">
      {total === 0 ? (
        <EmptyNotice>
          ยังไม่มีช่างในระบบ — เพิ่มเองด้านล่าง หรือให้ช่างสแกน QR เพื่อสมัคร
          แล้วตรวจในหน้าคำขอสมัคร
        </EmptyNotice>
      ) : null}

      <Gate label="รอตรวจ" hint="คำขอสมัครใหม่ที่ต้องตรวจ" count={data.needsReview.length}>
        {data.needsReview.length > 0 ? (
          <>
            <ul className="rounded-card border-edge bg-card shadow-card flex flex-col border px-4">
              {data.needsReview.map((r) => (
                <MemberRow key={r.id} name={r.name} />
              ))}
            </ul>
            <Link
              href={registrationsHref}
              className="text-action focus-visible:ring-action inline-flex items-center gap-1 self-start rounded-md text-sm font-medium focus:outline-none focus-visible:ring-2"
            >
              ตรวจคำขอสมัคร
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </>
        ) : null}
      </Gate>

      <Gate label="รอยืนยัน" hint="รอ PM ยืนยันค่าแรง/ระดับ" count={data.awaitingConfirm.length}>
        {data.awaitingConfirm.length > 0 ? (
          <ul className="rounded-card border-edge bg-card shadow-card flex flex-col border px-4">
            {data.awaitingConfirm.map((m) => (
              <MemberRow
                key={m.id}
                name={m.name}
                {...(m.projectLabel ? { projectLabel: m.projectLabel } : {})}
                {...(m.bankPending ? { bankPending: true } : {})}
              />
            ))}
          </ul>
        ) : null}
      </Gate>

      <Gate label="พร้อม" hint="ยืนยันแล้ว ทำงานได้" count={data.ready.length}>
        {data.ready.length > 0 ? (
          <ul className="rounded-card border-edge bg-card shadow-card flex flex-col border px-4">
            {data.ready.map((m) => (
              <MemberRow
                key={m.id}
                name={m.name}
                level={m.level}
                {...(m.projectLabel ? { projectLabel: m.projectLabel } : {})}
              />
            ))}
          </ul>
        ) : null}
      </Gate>
    </div>
  );
}
