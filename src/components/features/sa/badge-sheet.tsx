"use client";

// Spec 306 U1 — printable QR badge sheet. Cards are grouped per project; each
// card = worker name + PRC code + a server-rendered QR SVG whose payload is the
// worker id (opaque — meaningful only inside an authenticated SA session).
// Printing is the browser dialog (no PDF pipeline); print CSS keeps one card
// intact per cell and hides the on-screen controls.

export interface BadgeSheetCard {
  workerId: string;
  name: string;
  code: string | null;
  svg: string;
}

export interface BadgeSheetGroup {
  project: { id: string; code: string; name: string };
  badges: BadgeSheetCard[];
}

export function BadgeSheet({ groups }: { groups: BadgeSheetGroup[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-accent text-on-accent min-h-11 w-full rounded-lg px-4 text-sm font-bold"
        >
          พิมพ์บัตร
        </button>
        <p className="text-ink-muted text-meta mt-2">
          พิมพ์แล้วเคลือบพลาสติก ให้ช่างพกไว้สแกนเช็คชื่อตอนเช้า
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.project.id} className="flex flex-col gap-3">
          <h2 className="text-ink text-sm font-bold print:text-black">
            {group.project.name}
            <span className="text-ink-muted text-meta ml-2 font-normal print:text-black">
              {group.project.code}
            </span>
          </h2>
          <ul className="grid grid-cols-2 gap-3 print:gap-2">
            {group.badges.map((badge) => (
              <li
                key={badge.workerId}
                className="border-edge bg-surface flex break-inside-avoid flex-col items-center gap-2 rounded-xl border p-3 print:rounded-none print:border-black print:bg-white"
              >
                <div
                  aria-label={`QR บัตรช่าง — ${badge.name}`}
                  className="rounded bg-white p-1.5"
                  dangerouslySetInnerHTML={{ __html: badge.svg }}
                />
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className="text-ink text-sm font-bold break-words print:text-black">
                    {badge.name}
                  </span>
                  <span className="text-ink-secondary text-meta tabular-nums print:text-black">
                    {badge.code ?? "—"}
                  </span>
                  <span className="text-ink-muted text-meta print:text-black">
                    {group.project.code}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
