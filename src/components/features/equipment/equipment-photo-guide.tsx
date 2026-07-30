// Spec 382 U2 (D3) — the drawn "sample" for each slot.
//
// Drawings, not reference photos: one real machine's photo teaches the wrong
// thing for every other machine type, and a drawing can show the ANGLE and what
// must be legible without implying "this model". They also cost no assets, no
// storage, no upload, and render offline.
//
// `currentColor` throughout so both themes work with no per-theme asset, and
// aria-hidden because the instruction is the adjacent Thai text — a screen reader
// should not narrate a sketch.

import type { EquipmentPhotoKind } from "@/lib/equipment/photo-kinds";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 48 40" aria-hidden className="text-ink-muted size-full">
      {/* viewfinder corners — the same visual language on every slot, so the
          drawing inside reads as "what the camera should see". */}
      <g {...STROKE} opacity={0.5}>
        <path d="M3 11V5a2 2 0 0 1 2-2h6" />
        <path d="M37 3h6a2 2 0 0 1 2 2v6" />
        <path d="M45 29v6a2 2 0 0 1-2 2h-6" />
        <path d="M11 37H5a2 2 0 0 1-2-2v-6" />
      </g>
      {children}
    </svg>
  );
}

export function EquipmentPhotoGuide({ kind }: { kind: EquipmentPhotoKind }) {
  if (kind === "item") {
    // The whole machine, small in frame — the point is "step back".
    return (
      <Frame>
        <g {...STROKE}>
          <rect x="15" y="14" width="18" height="13" rx="2" />
          <circle cx="19.5" cy="30" r="2.5" />
          <circle cx="28.5" cy="30" r="2.5" />
          <path d="M19 14v-3h7v3" />
        </g>
      </Frame>
    );
  }

  if (kind === "nameplate") {
    // A plate filling the frame, with a legible serial line — "get close".
    return (
      <Frame>
        <g {...STROKE}>
          <rect x="11" y="12" width="26" height="17" rx="1.5" />
          <path d="M15 18h10" opacity={0.6} />
          <path d="M15 23h18" />
          <circle cx="14" cy="14.5" r="0.8" opacity={0.6} />
          <circle cx="34" cy="14.5" r="0.8" opacity={0.6} />
        </g>
      </Frame>
    );
  }

  if (kind === "brand") {
    // A badge on a body panel.
    return (
      <Frame>
        <g {...STROKE}>
          <path d="M9 27h30" opacity={0.5} />
          <rect x="14" y="13" width="20" height="10" rx="5" />
          <path d="M19 18h10" />
        </g>
      </Frame>
    );
  }

  // qr_tag — our sticker ON the machine: a QR square attached to a body outline.
  return (
    <Frame>
      <g {...STROKE}>
        <path d="M9 30h30" opacity={0.5} />
        <rect x="17" y="10" width="17" height="17" rx="1.5" />
        <rect x="20" y="13" width="4" height="4" />
        <rect x="27" y="13" width="4" height="4" />
        <rect x="20" y="20" width="4" height="4" />
        <path d="M27 20h1.5M30 20v4M27 24h4" />
      </g>
    </Frame>
  );
}
