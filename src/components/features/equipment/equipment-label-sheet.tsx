"use client";

// Spec 370 U3 — the printable QR label grid. Each label = the scan deep link
// as a QR + the item's name and identifiers, sized for common A4 sticker
// paper (3 columns). The deep-link TEXT prints under each QR because it is
// also what an NFC NDEF sticker gets written with (docs/automations.md
// "equipment-scan-stickers") — one page serves both tag kinds.
//
// QR generation is client-side (`qrcode` toDataURL — the same dep the muster
// badge round-trip test exercises); print styling hides everything but the
// grid via the print: variants.

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface LabelItem {
  id: string;
  name: string;
  serialNo: string | null;
  assetTag: string | null;
}

export function EquipmentLabelSheet({
  items,
  appOrigin,
}: {
  items: readonly LabelItem[];
  appOrigin: string;
}) {
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const it of items) {
        out[it.id] = await QRCode.toDataURL(`${appOrigin}/equipment/scan?item=${it.id}`, {
          margin: 1,
          width: 220,
        });
      }
      if (live) setUrls(out);
    })();
    return () => {
      live = false;
    };
  }, [items, appOrigin]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <p className="text-ink-secondary text-meta">
          {items.length} ป้าย — กระดาษสติกเกอร์ A4 · แท็ก NFC เขียนลิงก์ใต้ QR ด้วยแอปเขียน NDEF
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-action text-on-fill rounded-control min-h-11 px-4 text-sm font-semibold"
        >
          พิมพ์
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {items.map((it) => (
          <div
            key={it.id}
            className="border-edge flex break-inside-avoid flex-col items-center gap-1 rounded border p-3 text-center"
          >
            {urls[it.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[it.id]} alt={`QR ${it.name}`} className="h-28 w-28" />
            ) : (
              <div className="bg-sunk h-28 w-28 rounded" />
            )}
            <p className="text-ink text-xs font-medium">{it.name}</p>
            <p className="text-ink-secondary text-[10px]">
              {[it.assetTag, it.serialNo].filter(Boolean).join(" · ") || " "}
            </p>
            <p className="text-ink-muted text-[8px] break-all">/equipment/scan?item={it.id}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
