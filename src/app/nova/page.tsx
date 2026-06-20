// Spec 162 U1 — the Nova operator console. super_admin only: coins are
// super_admin-read (spec 160 U2 RLS), invisible to external DCs (ADR 0060 §4),
// and gift-first (ADR 0061) keeps the worker-facing Nova for later. Reads go
// through the RLS server client — the super_admin session sees every coin_posting.
// Coins are points (no baht peg, ADR 0060), shown as "เหรียญ", never baht.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { COIN_SOURCE_LABEL } from "@/lib/nova/coin-source";
import { NovaAwardForm } from "@/components/features/nova/nova-award-form";

export const metadata = { title: "Nova" };

function coins(n: number): string {
  return `${n.toLocaleString("th-TH")} เหรียญ`;
}

export default async function NovaPage() {
  const ctx = await requireRole(["super_admin"]);
  const supabase = await createClient();

  const [{ data: workers }, { data: postings }] = await Promise.all([
    supabase.from("workers").select("id, name").eq("active", true).order("name"),
    supabase
      .from("coin_postings")
      .select("id, worker_id, source, amount, reason, occurred_at")
      .order("occurred_at", { ascending: false }),
  ]);

  const roster = workers ?? [];
  const ledger = postings ?? [];
  const nameById = new Map(roster.map((w) => [w.id, w.name]));

  // Balance is DERIVED from the postings (spec 160 U2 — never a stored integer).
  const balanceByWorker = new Map<string, number>();
  for (const p of ledger) {
    balanceByWorker.set(p.worker_id, (balanceByWorker.get(p.worker_id) ?? 0) + Number(p.amount));
  }
  const balances = roster
    .map((w) => ({ id: w.id, name: w.name, balance: balanceByWorker.get(w.id) ?? 0 }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "th"));

  const recent = ledger.slice(0, 30);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">Nova</h1>
        <p className="text-ink-secondary mt-0.5 text-xs">
          เหรียญรางวัลของทีมงาน — มอบเหรียญสำหรับพฤติกรรมที่ดี (มาตรงเวลา · งานไม่มีตำหนิ)
        </p>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* Award — the operator's manual recognition tool until the automatic
            earn-rules (spec 161 U5/U6) land. */}
        {roster.length > 0 ? (
          <NovaAwardForm workers={roster} />
        ) : (
          <EmptyNotice>ยังไม่มีทีมงานในระบบ</EmptyNotice>
        )}

        {/* Balances — derived from the ledger. */}
        <div>
          <h2 className={SECTION_HEADING}>ยอดเหรียญ</h2>
          {balances.length > 0 ? (
            <ul className={`${CARD} divide-edge flex flex-col divide-y`}>
              {balances.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-ink min-w-0 truncate text-sm font-medium">{b.name}</span>
                  <span className="text-ink shrink-0 text-sm font-bold tabular-nums">
                    {coins(b.balance)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNotice>ยังไม่มียอดเหรียญ</EmptyNotice>
          )}
        </div>

        {/* The ledger — append-only, newest first. */}
        <div>
          <h2 className={SECTION_HEADING}>ประวัติการมอบเหรียญ</h2>
          {recent.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {recent.map((p) => {
                const n = Number(p.amount);
                return (
                  <li key={p.id} className={CARD}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink min-w-0 truncate text-sm font-medium">
                        {nameById.get(p.worker_id) ?? "—"}
                      </span>
                      <span
                        className={`shrink-0 text-sm font-bold tabular-nums ${
                          n < 0 ? "text-danger" : "text-done-strong"
                        }`}
                      >
                        {n > 0 ? "+" : ""}
                        {n.toLocaleString("th-TH")}
                      </span>
                    </div>
                    <p className="text-ink-secondary mt-1 text-xs">
                      {COIN_SOURCE_LABEL[p.source]}
                      <span className="text-ink-muted mx-1.5">·</span>
                      {formatThaiDate(p.occurred_at)}
                    </p>
                    {p.reason ? (
                      <p className="text-ink-secondary mt-0.5 text-xs whitespace-pre-wrap">
                        {p.reason}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyNotice>ยังไม่มีการมอบเหรียญ</EmptyNotice>
          )}
        </div>
      </section>
    </PageShell>
  );
}
