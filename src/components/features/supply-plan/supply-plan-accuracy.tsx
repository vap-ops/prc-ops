// Spec 176 U5 — the read-only planning-accuracy surface (the PM-accuracy number).
// Server-safe presentational component: it sums the per-WP rows from
// supply_plan_accuracy() into project totals, highlights the unplanned-miss tally
// (the misses that count against the PM), and lists the per-WP breakdown. No
// 'use client' — pure render, no state or handlers.

export type AccuracyRow = {
  workPackageId: string | null;
  wpCode: string | null;
  wpName: string | null;
  plannedLines: number;
  plannedQty: number;
  unplannedMiss: number;
  fairReactive: number;
  untagged: number;
};

const CARD = "border-edge bg-card rounded-control border px-4 py-3";

function Stat({
  testId,
  label,
  value,
  tone,
}: {
  testId: string;
  label: string;
  value: number;
  tone?: "miss";
}) {
  return (
    <div className={`${CARD} flex flex-col gap-0.5`}>
      <span className="text-meta text-ink-secondary">{label}</span>
      <span
        data-testid={testId}
        className={`text-title font-bold ${tone === "miss" ? "text-danger" : "text-ink"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function SupplyPlanAccuracy({ rows }: { rows: AccuracyRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      plannedLines: acc.plannedLines + r.plannedLines,
      unplannedMiss: acc.unplannedMiss + r.unplannedMiss,
      fairReactive: acc.fairReactive + r.fairReactive,
      untagged: acc.untagged + r.untagged,
    }),
    { plannedLines: 0, unplannedMiss: 0, fairReactive: 0, untagged: 0 },
  );

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-subtitle text-ink font-bold">ความแม่นยำการวางแผน</h2>
        <p className="text-meta text-ink-secondary">
          วางแผนไว้ เทียบกับคำขอซื้อแบบตั้งรับ — “วางแผนตกหล่น”
          คือส่วนที่นับเป็นความคลาดเคลื่อนของการวางแผน
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-secondary text-body">ยังไม่มีข้อมูลการวัด</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              testId="acc-total-planned"
              label="วางแผนไว้ (รายการ)"
              value={totals.plannedLines}
            />
            <Stat
              testId="acc-total-miss"
              label="วางแผนตกหล่น"
              value={totals.unplannedMiss}
              tone="miss"
            />
            <Stat testId="acc-total-fair" label="ตั้งรับมีเหตุ" value={totals.fairReactive} />
            <Stat testId="acc-total-untagged" label="ไม่ระบุเหตุ" value={totals.untagged} />
          </div>

          <div className={`${CARD} overflow-x-auto p-0`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-meta text-ink-secondary border-edge border-b">
                  <th className="px-4 py-2 font-medium">งาน</th>
                  <th className="px-3 py-2 text-right font-medium">วางแผน</th>
                  <th className="px-3 py-2 text-right font-medium">ตกหล่น</th>
                  <th className="px-4 py-2 text-right font-medium">ตั้งรับมีเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.workPackageId ?? "site-general"}
                    className="border-edge border-b last:border-0"
                  >
                    <td className="px-4 py-2">
                      {r.workPackageId ? (
                        <>
                          <span className="text-ink-secondary font-mono">{r.wpCode}</span>
                          <span className="text-ink-muted mx-1">·</span>
                          <span className="text-ink">{r.wpName}</span>
                        </>
                      ) : (
                        <span className="text-ink">ทั้งโครงการ</span>
                      )}
                    </td>
                    <td className="text-ink px-3 py-2 text-right tabular-nums">{r.plannedLines}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        r.unplannedMiss > 0 ? "text-danger" : "text-ink-muted"
                      }`}
                    >
                      {r.unplannedMiss}
                    </td>
                    <td className="text-ink-secondary px-4 py-2 text-right tabular-nums">
                      {r.fairReactive}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
