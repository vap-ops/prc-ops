"use client";

// Spec 392 U2b — one zone, drawn.
//
// 'use client' justification (CLAUDE.md): react-konva touches `window` at
// import time and the whole point of this component is pointer interaction.
// It is only ever reached through `zone-canvas-lazy`'s dynamic ssr:false
// import, so it never enters a server render or the main bundle.
//
// ⭐ ONE renderer, with a mode. Spec §5 gives field devices a read-only map
// while managers drag the same shapes; a second read-only copy of this
// geometry would be free to drift from the editable one, and the drift would
// be invisible (both would render *something*). `readOnly` turns off dragging
// and the transformer, and changes nothing about where a shape is.
//
// The `switch` below has NO `default:` arm on purpose (spec §9): a new
// `zone_shape` enum value must fail the compile here rather than render as
// nothing while the migration, the RPC and the pgTAP all stay green.

import { Ellipse, Line, Rect } from "react-konva";
import type Konva from "konva";
import { boxToPixels, polygonToPixels, type StageSize } from "@/lib/zones/canvas-geometry";
import type { ZoneGeometry, ZoneShape } from "@/lib/zones/validate-zone";

export interface ZoneShapeNodeProps {
  id: string;
  shape: ZoneShape;
  geometry: ZoneGeometry;
  stage: StageSize;
  selected: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, node: Konva.Node) => void;
  onTransformEnd: (id: string, node: Konva.Node) => void;
}

// Field-First tokens are CSS variables the canvas cannot read — Konva paints to
// a bitmap, not the DOM. These are the same two hues the zone chip uses,
// resolved once here so the canvas has a single source rather than a literal
// per shape.
const FILL = "rgba(37, 99, 235, 0.18)";
const FILL_SELECTED = "rgba(37, 99, 235, 0.32)";
const STROKE = "#2563eb";

export function ZoneShapeNode({
  id,
  shape,
  geometry,
  stage,
  selected,
  readOnly,
  onSelect,
  onDragEnd,
  onTransformEnd,
}: ZoneShapeNodeProps) {
  const common = {
    id,
    name: "zone-shape",
    fill: selected ? FILL_SELECTED : FILL,
    stroke: STROKE,
    strokeWidth: selected ? 3 : 2,
    // Konva scales the stroke with the shape during a transform; keeping the
    // width fixed is what makes a resized zone still read as the same object.
    strokeScaleEnabled: false,
    draggable: !readOnly,
    onClick: () => onSelect(id),
    onTap: () => onSelect(id),
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => onDragEnd(id, event.target),
    onTransformEnd: (event: Konva.KonvaEventObject<Event>) => onTransformEnd(id, event.target),
  };

  switch (shape) {
    case "rect":
    case "rounded_rect": {
      const px = boxToPixels(geometry as never, stage);
      return (
        <Rect
          {...common}
          x={px.x}
          y={px.y}
          width={px.width}
          height={px.height}
          cornerRadius={shape === "rounded_rect" ? 12 : 0}
        />
      );
    }
    case "ellipse": {
      const px = boxToPixels(geometry as never, stage);
      // Konva's Ellipse is centre-origin; the stored box is corner-origin, the
      // same convention every other shape uses. Converting here keeps the DB
      // shape-agnostic.
      return (
        <Ellipse
          {...common}
          x={px.x + px.width / 2}
          y={px.y + px.height / 2}
          radiusX={px.width / 2}
          radiusY={px.height / 2}
        />
      );
    }
    case "polygon": {
      return (
        <Line {...common} points={polygonToPixels(geometry as never, stage)} closed x={0} y={0} />
      );
    }
  }
}
