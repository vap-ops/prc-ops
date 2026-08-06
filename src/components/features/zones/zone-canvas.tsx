"use client";

// Spec 392 U2b — ผังโซน, the drawing surface.
//
// 'use client' justification (CLAUDE.md): this is pointer interaction over a
// Konva stage; react-konva touches `window` at import time. Reached only
// through `zone-canvas-lazy`'s dynamic ssr:false import so konva never enters
// the main bundle (spec §3) — pinned in `zone-canvas-island.test.ts`.
//
// ⭐ The canvas is the SECOND path to these operations, never the only one.
// The U2a list already creates, renames, re-codes and deletes a zone, and a
// canvas is opaque to a keyboard and a screen reader. So this surface owns
// exactly the two things a list cannot express — WHERE a zone is and WHAT
// SHAPE it has — and hands everything else back to the list underneath it.
//
// ⭐ The engine never sees the database. Konva speaks pixels; every write goes
// through `canvas-geometry`'s conversion to `[0,1]` fractions, so the stage can
// be any size and a background swap moves nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Circle, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { saveZone } from "@/app/projects/[projectId]/zones/actions";
import {
  ZONE_SNAP_STEP,
  clampBoxToUnit,
  pixelsToBox,
  pixelsToPolygon,
  polygonToPixels,
  snapBox,
  snapPolygon,
  type StageSize,
} from "@/lib/zones/canvas-geometry";
import type { BoxGeometry, ZoneGeometry, ZoneShape } from "@/lib/zones/validate-zone";
import { ZONE_LABEL } from "@/lib/i18n/labels";
import { ZoneShapeNode } from "./zone-shape-node";
import type { CanvasZone, ZoneCanvasProps } from "./zone-canvas-types";

export type { CanvasZone, ZoneCanvasProps } from "./zone-canvas-types";

/** The map box's aspect. A site plan is landscape; the stage width follows the container. */
const ASPECT = 0.625;

const SHAPE_TOOLS: ReadonlyArray<{ shape: ZoneShape; label: string }> = [
  { shape: "rect", label: "สี่เหลี่ยม" },
  { shape: "rounded_rect", label: "สี่เหลี่ยมมุมมน" },
  { shape: "ellipse", label: "วงรี" },
  { shape: "polygon", label: "หลายเหลี่ยม" },
];

function isPolygon(
  geometry: ZoneGeometry,
): geometry is { points: ReadonlyArray<readonly [number, number]> } {
  return Object.prototype.hasOwnProperty.call(geometry, "points");
}

/** Converting a box to a polygon starts from its four corners — the only
 *  starting shape that leaves the zone exactly where the manager put it. */
function boxToCorners(box: BoxGeometry): ReadonlyArray<readonly [number, number]> {
  return [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
}

/** A polygon collapses back to its bounding box. Lossy on purpose and said so
 *  in the confirm copy — the alternative is refusing the switch entirely. */
function cornersToBox(points: ReadonlyArray<readonly [number, number]>): BoxGeometry {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return clampBoxToUnit({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
}

export function ZoneCanvas({ projectId, mapId, zones, readOnly = false }: ZoneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);

  const [stage, setStage] = useState<StageSize>({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Geometry the manager has moved but the server has not echoed back yet.
  // Keyed by zone id; the server row wins as soon as the route revalidates.
  const [draft, setDraft] = useState<Record<string, { shape: ZoneShape; geometry: ZoneGeometry }>>(
    {},
  );
  // Undo is a stack of {id, shape, geometry} snapshots taken BEFORE each write.
  const [history, setHistory] = useState<
    Array<{ id: string; shape: ZoneShape; geometry: ZoneGeometry }>
  >([]);

  const resolved = useMemo(
    () => zones.map((zone) => ({ ...zone, ...(draft[zone.id] ?? {}) })),
    [zones, draft],
  );
  const selected = resolved.find((zone) => zone.id === selectedId) ?? null;

  // The stage has no intrinsic size; it takes the container's width and the map
  // aspect. Measured rather than assumed — a Konva stage is 0×0 for one frame,
  // which `pixelsToBox` refuses to turn into NaN.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      setStage({ width, height: Math.round(width * ASPECT) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Konva's Transformer attaches to nodes imperatively, so selection has to be
  // pushed to it after every render that changes which shape is selected.
  useEffect(() => {
    const transformer = transformerRef.current;
    const layer = layerRef.current;
    if (!transformer || !layer) return;
    // A polygon is edited by its vertices, not by a bounding-box transformer —
    // attaching one would let a drag scale points out of the map.
    const target =
      selectedId && selected && !isPolygon(selected.geometry) && !readOnly
        ? layer.findOne(`#${selectedId}`)
        : null;
    transformer.nodes(target ? [target] : []);
  }, [selectedId, selected, readOnly, resolved]);

  const persist = useCallback(
    async (zone: CanvasZone, next: { shape: ZoneShape; geometry: ZoneGeometry }) => {
      setDraft((current) => ({ ...current, [zone.id]: next }));
      setError(null);
      const result = await saveZone({
        projectId,
        mapId,
        zoneId: zone.id,
        code: zone.code,
        name: zone.name,
        shape: next.shape,
        geometry: next.geometry,
      });
      if (!result.ok) {
        // Put the zone back where it was: a shape left under the pointer after
        // a refused save claims a position the database does not hold.
        setDraft((current) => {
          const rest = { ...current };
          delete rest[zone.id];
          return rest;
        });
        setHistory((stack) => stack.slice(0, -1));
        setError(result.error);
      }
    },
    [projectId, mapId],
  );

  const commit = useCallback(
    (zone: CanvasZone, next: { shape: ZoneShape; geometry: ZoneGeometry }) => {
      setHistory((stack) => [
        ...stack.slice(-19),
        { id: zone.id, shape: zone.shape, geometry: zone.geometry },
      ]);
      void persist(zone, next);
    },
    [persist],
  );

  const handleDragEnd = useCallback(
    (id: string, node: Konva.Node) => {
      const zone = resolved.find((z) => z.id === id);
      if (!zone || stage.width === 0) return;
      if (isPolygon(zone.geometry)) {
        // A dragged polygon carries an offset rather than moved points.
        const shifted = zone.geometry.points.map(
          ([x, y]) =>
            [x + node.x() / stage.width, y + node.y() / stage.height] as readonly [number, number],
        );
        node.position({ x: 0, y: 0 });
        commit(zone, { shape: zone.shape, geometry: snapPolygon({ points: shifted }, snap) });
        return;
      }
      const box = pixelsToBox(
        {
          x: zone.shape === "ellipse" ? node.x() - node.width() / 2 : node.x(),
          y: zone.shape === "ellipse" ? node.y() - node.height() / 2 : node.y(),
          width: node.width(),
          height: node.height(),
        },
        stage,
      );
      commit(zone, { shape: zone.shape, geometry: snapBox(box, snap) });
    },
    [resolved, stage, snap, commit],
  );

  const handleTransformEnd = useCallback(
    (id: string, node: Konva.Node) => {
      const zone = resolved.find((z) => z.id === id);
      if (!zone || stage.width === 0 || isPolygon(zone.geometry)) return;
      // Konva reports a resize as a SCALE, not a new size. Baking it back into
      // width/height and resetting the scale is what keeps the stored geometry
      // a plain box rather than a box plus a transform nobody else applies.
      const width = node.width() * node.scaleX();
      const height = node.height() * node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      const box = pixelsToBox(
        {
          x: zone.shape === "ellipse" ? node.x() - width / 2 : node.x(),
          y: zone.shape === "ellipse" ? node.y() - height / 2 : node.y(),
          width,
          height,
        },
        stage,
      );
      commit(zone, { shape: zone.shape, geometry: snapBox(box, snap) });
    },
    [resolved, stage, snap, commit],
  );

  const handleVertexDrag = useCallback(
    (index: number, node: Konva.Node) => {
      if (!selected || !isPolygon(selected.geometry) || stage.width === 0) return;
      const flat = polygonToPixels(selected.geometry, stage);
      flat[index * 2] = node.x();
      flat[index * 2 + 1] = node.y();
      commit(selected, {
        shape: selected.shape,
        geometry: snapPolygon(pixelsToPolygon(flat, stage), snap),
      });
    },
    [selected, stage, snap, commit],
  );

  const handleShapeChange = useCallback(
    (shape: ZoneShape) => {
      if (!selected || shape === selected.shape) return;
      // Narrowed on the VALUE rather than on a boolean: a `wasPolygon` flag
      // reads the same to a human and tells the compiler nothing, so the
      // `as BoxGeometry` it forces would be the only thing standing between a
      // polygon and `boxToCorners` reading four undefined corners.
      const current = selected.geometry;
      const geometry: ZoneGeometry = isPolygon(current)
        ? shape === "polygon"
          ? current
          : cornersToBox(current.points)
        : shape === "polygon"
          ? { points: boxToCorners(current) }
          : current;
      commit(selected, { shape, geometry });
    },
    [selected, commit],
  );

  const handleUndo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    const zone = resolved.find((z) => z.id === previous.id);
    setHistory((stack) => stack.slice(0, -1));
    if (!zone) return;
    void persist(zone, { shape: previous.shape, geometry: previous.geometry });
  }, [history, resolved, persist]);

  const toolButton =
    "rounded-control border-edge text-meta focus-visible:ring-action border px-3 py-2 font-medium focus:outline-none focus-visible:ring-2 disabled:opacity-40";

  return (
    <div>
      {!readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {SHAPE_TOOLS.map((tool) => (
            <button
              key={tool.shape}
              type="button"
              onClick={() => handleShapeChange(tool.shape)}
              disabled={selected === null}
              aria-pressed={selected?.shape === tool.shape}
              className={`${toolButton} ${
                selected?.shape === tool.shape ? "bg-action text-on-fill" : "bg-card text-ink"
              }`}
            >
              {tool.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSnap((on) => !on)}
            aria-pressed={snap}
            className={`${toolButton} ${snap ? "bg-action text-on-fill" : "bg-card text-ink"}`}
          >
            {`ดูดเข้าเส้นตาราง ${Math.round(ZONE_SNAP_STEP * 100)}%`}
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            className={`${toolButton} bg-card text-ink`}
          >
            เลิกทำ
          </button>
        </div>
      )}

      {!readOnly && (
        <p className="text-meta text-ink-secondary mb-2" role="note">
          {selected
            ? `เลือก ${selected.code} ${selected.name} — ลากเพื่อย้าย ${isPolygon(selected.geometry) ? "ลากจุดมุมเพื่อปรับรูป" : "ลากมุมกรอบเพื่อปรับขนาด"}`
            : `แตะ${ZONE_LABEL}บนผังเพื่อเลือก แล้วลากเพื่อจัดตำแหน่ง — ชื่อและรหัสแก้ได้จากรายการด้านล่าง`}
        </p>
      )}

      {error !== null && (
        <p className="text-meta text-danger mb-2" role="alert">
          {error}
        </p>
      )}

      <div
        ref={containerRef}
        className="rounded-card border-edge bg-sunk overflow-hidden border"
        style={{ height: stage.height || undefined }}
      >
        {stage.width > 0 && (
          <Stage
            width={stage.width}
            height={stage.height}
            onMouseDown={(event) => {
              // A press on empty canvas clears the selection — otherwise the
              // transformer stays attached to a zone the manager has left.
              if (event.target === event.target.getStage()) setSelectedId(null);
            }}
          >
            <Layer ref={layerRef}>
              {resolved.map((zone) => (
                <ZoneShapeNode
                  key={zone.id}
                  id={zone.id}
                  shape={zone.shape}
                  geometry={zone.geometry}
                  stage={stage}
                  selected={zone.id === selectedId}
                  readOnly={readOnly}
                  onSelect={setSelectedId}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                />
              ))}

              {!readOnly && selected && isPolygon(selected.geometry)
                ? selected.geometry.points.map(([x, y], index) => (
                    <Circle
                      key={`${selected.id}-${index}`}
                      x={x * stage.width}
                      y={y * stage.height}
                      radius={8}
                      fill="#ffffff"
                      stroke="#2563eb"
                      strokeWidth={2}
                      draggable
                      onDragEnd={(event) => handleVertexDrag(index, event.target)}
                    />
                  ))
                : null}

              {!readOnly && (
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  // A zone smaller than the snap grid cannot be re-grabbed on a
                  // touch screen, and the DB refuses a zero size outright.
                  boundBoxFunc={(previous, next) =>
                    next.width < stage.width * ZONE_SNAP_STEP ||
                    next.height < stage.height * ZONE_SNAP_STEP
                      ? previous
                      : next
                  }
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
}
