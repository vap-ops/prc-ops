// Spec 392 U2b — the canvas's prop types, in a leaf module of their own.
//
// The lazy wrapper needs these types and MUST NOT import the module that
// carries konva, even for a type: `import type` is erased at build, but the
// island guard scans source text and cannot tell an erased import from a real
// one without trusting a keyword. A leaf module removes the question rather
// than answering it — the same move the server/client boundary needed when a
// shared constant lived in a `server-only` module (spec 371 U2).

import type { ZoneGeometry, ZoneShape } from "@/lib/zones/validate-zone";

export interface CanvasZone {
  id: string;
  code: string;
  name: string;
  shape: ZoneShape;
  geometry: ZoneGeometry;
}

export interface ZoneCanvasProps {
  projectId: string;
  mapId: string;
  zones: readonly CanvasZone[];
  /** Field devices get the same geometry with no drag, no anchors, no toolbar. */
  readOnly?: boolean;
}
