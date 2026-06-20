// Spec 161 U12 — per-worker Nova detail. super_admin only: the operator's window
// into one worker's coins — balance, what's VESTED (theirs), SPENDABLE, and still
// UNVESTED (at risk) — plus the ledger, redemptions, confiscations, and the
// per-worker actions (saver bonus / redeem / confiscate). Table reads go via the
// admin client (zero-grant economics); the gated vesting derives go via the RLS
// server client (the super JWT the SECURITY DEFINER gate needs).

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { EmptyNotice } from "@/components/features/common/notices";
import { formatThaiDate } from "@/lib/i18n/labels";
import { COIN_SOURCE_LABEL } from "@/lib/nova/coin-source";
import { CONFISCATION_REASON_LABEL, type ConfiscationReason } from "@/lib/nova/confiscation";
import { NovaWorkerActions } from "@/components/features/nova/nova-worker-actions";

export const metadata = { title: "ทีมงาน · Nova" };

const coins = (n: number) => `${n.toLocaleString("th-TH")} เหรียญ`;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NovaWorkerPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await requireRole(["super_admin"]);
  const admin = createAdminClient();
  const rls = await createClient();

  const [
    { data: worker },
    { data: postings },
    { data: redemptions },
    { data: confiscations },
    { data: items },
  ] = await Promise.all([
    admin.from("workers").select("id, name, active").eq("id", id).maybeSingle(),
    admin
      .from("coin_postings")
      .select("id, source, amount, reason, occurred_at")
      .eq("worker_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    admin
      .from("shop_redemptions")
      .select("id, price_coins, redeemed_at")
      .eq("worker_id", id)
      .order("redeemed_at", { ascending: false }),
    admin
      .from("coin_confiscations")
      .select("id, reason, amount, note, confiscated_at")
      .eq("worker_id", id)
      .order("confiscated_at", { ascending: false }),
    admin.from("shop_items").select("id, name, price_coins").eq("active", true).order("sort_order"),
  ]);

  if (!worker) notFound();

  // Gated derives (SECURITY DEFINER, super/director) — via the RLS client's super JWT.
  const [{ data: balance }, { data: unvested }, { data: vested }, { data: spendable }] =
    await Promise.all([
      rls.rpc("coin_balance", { p_worker: id }),
      rls.rpc("coin_unvested_balance", { p_worker: id }),
      rls.rpc("coin_vested_balance", { p_worker: id }),
      rls.rpc("coin_spendable_balance", { p_worker: id }),
    ]);

  const shopItems = (items ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    price_coins: Number(i.price_coins),
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/nova" backLabel="Nova">
        <h1 className="text-title text-ink font-bold tracking-tight">{worker.name}</h1>
        <p className="text-ink-secondary mt-0.5 text-xs">เหรียญ Nova · ยอด · สุกงอม · ใช้ได้</p>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* Balance breakdown. */}
        <div className={CARD}>
          <h2 className={SECTION_HEADING}>ยอดเหรียญ</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-secondary">ยอดรวม</dt>
            <dd className="text-ink text-right font-bold tabular-nums">{coins(Number(balance ?? 0))}</dd>
            <dt className="text-ink-secondary">สุกงอม (เป็นของทีมงาน)</dt>
            <dd className="text-done-strong text-right tabular-nums">{coins(Number(vested ?? 0))}</dd>
            <dt className="text-ink-secondary">ใช้ได้ (แลกของได้)</dt>
            <dd className="text-ink text-right tabular-nums">{coins(Number(spendable ?? 0))}</dd>
            <dt className="text-ink-secondary">ยังไม่สุกงอม (ริบได้)</dt>
            <dd className="text-ink text-right tabular-nums">{coins(Number(unvested ?? 0))}</dd>
          </dl>
        </div>

        <NovaWorkerActions workerId={worker.id} shopItems={shopItems} />

        {/* Confiscations. */}
        {confiscations && confiscations.length > 0 ? (
          <div>
            <h2 className={SECTION_HEADING}>ประวัติการริบ</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {confiscations.map((c) => (
                <li key={c.id} className={CARD}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink text-sm font-medium">
                      {CONFISCATION_REASON_LABEL[c.reason as ConfiscationReason] ?? c.reason}
                    </span>
                    <span className="text-danger shrink-0 text-sm font-bold tabular-nums">
                      −{Number(c.amount).toLocaleString("th-TH")}
                    </span>
                  </div>
                  <p className="text-ink-secondary mt-0.5 text-xs">
                    {formatThaiDate(c.confiscated_at)}
                    {c.note ? <span className="text-ink-muted"> · {c.note}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Redemptions. */}
        {redemptions && redemptions.length > 0 ? (
          <div>
            <h2 className={SECTION_HEADING}>ประวัติการแลก</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {redemptions.map((rd) => (
                <li key={rd.id} className={`${CARD} flex items-center justify-between gap-3`}>
                  <span className="text-ink-secondary text-xs">{formatThaiDate(rd.redeemed_at)}</span>
                  <span className="text-ink shrink-0 text-sm tabular-nums">
                    −{Number(rd.price_coins).toLocaleString("th-TH")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Ledger. */}
        <div>
          <h2 className={SECTION_HEADING}>ประวัติเหรียญ</h2>
          {postings && postings.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2">
              {postings.map((p) => {
                const n = Number(p.amount);
                return (
                  <li key={p.id} className={CARD}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink text-sm font-medium">
                        {COIN_SOURCE_LABEL[p.source]}
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
                    <p className="text-ink-secondary mt-0.5 text-xs">{formatThaiDate(p.occurred_at)}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyNotice>ยังไม่มีประวัติเหรียญ</EmptyNotice>
          )}
        </div>
      </section>
    </PageShell>
  );
}
