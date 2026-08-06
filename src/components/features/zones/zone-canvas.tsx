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

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Layer, Circle, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { saveZone } from "@/app/projects/[projectId]/zones/actions";
import {
  ZONE_SNAP_STEP,
  boxToCorners,
  cornersToBox,
  pixelsToBox,
  pixelsToPolygon,
  polygonLosesShape,
  polygonToPixels,
  snapBox,
  snapPolygon,
  type StageSize,
} from "@/lib/zones/canvas-geometry";
import {
  canvasReducer,
  initialCanvasState,
  resolveZone,
  undoTarget,
  type ZoneSnapshot,
} from "@/lib/zones/canvas-state";
import type { ZoneGeometry, ZoneShape } from "@/lib/zones/validate-zone";
import { ZONE_LABEL } from "@/lib/i18n/labels";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { ZoneShapeNode } from "./zone-shape-node";
import type { CanvasZone, ZoneCanvasProps } from "./zone-canvas-types";

export type { CanvasZone, ZoneCanvasProps } from "./zone-canvas-types";

/** The map box's aspect. A site plan is landscape; the stage width follows the container. */
const ASPECT = 0.625;

// A rejected round trip has no server message to show, so the canvas supplies
// one. Deliberately the retryable wording: a dropped connection IS retryable,
// unlike the permanent refusals the honest-copy rule is about.
const SAVE_FAILED = "บันทึกโซนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

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

export function ZoneCanvas({ projectId, mapId, zones, readOnly = false }: ZoneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  // Mirrors the reducer's own sequence counter. Both start at 0 and both
  // advance by exactly one per ISSUED write, which is why `handleUndo` must
  // refuse to call `write` when there is nothing to undo.
  const writeSeq = useRef(0);

  const [stage, setStage] = useState<StageSize>({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Optimistic writes, undo, and rollback all live in a pure reducer
  // (`canvas-state.ts`) rather than in loose state here — that is the only way
  // any of it is testable, because a canvas is opaque to RTL.
  const [writes, dispatch] = useReducer(canvasReducer, initialCanvasState);

  // ⭐ Bumped after a settled write, PER ZONE. Konva nodes are mutable objects
  // the pointer moves directly, so when a drag's SNAPPED result equals the
  // stored geometry, react-konva sees identical props, writes nothing back, and
  // the shape stays under the pointer while the database holds something else.
  // Snap is on by default at 5%, so on a ~1200px stage every drag under ~30px
  // does exactly that. Remounting the node forces its position to be re-derived
  // from the geometry, which is the only source of truth.
  //
  // ⚠️ Keyed BY ZONE, not one counter for the layer: a single counter in every
  // key remounts every shape on every settle, so finishing a drag on A while B
  // is mid-gesture destroys and recreates B's node under the pointer — B snaps
  // back and its `dragend` fires on a detached node, losing the move. That is
  // precisely the two-zones-at-once case the reducer's sequencing exists for.
  const [repaint, setRepaint] = useState<Record<string, number>>({});
  const bumpRepaint = useCallback((zoneId: string) => {
    setRepaint((current) => ({ ...current, [zoneId]: (current[zoneId] ?? 0) + 1 }));
  }, []);

  // The lossy polygon→box collapse waits on the themed ConfirmDialog (spec 18);
  // `window.confirm` is banned by the design doctrine and is the wrong register
  // for a destructive step anyway.
  const [pendingReshape, setPendingReshape] = useState<ZoneShape | null>(null);

  const resolved = useMemo(
    () =>
      zones.map((zone) => ({
        ...zone,
        ...resolveZone(writes, zone.id, { shape: zone.shape, geometry: zone.geometry }),
      })),
    [zones, writes],
  );
  const selected = resolved.find((zone) => zone.id === selectedId) ?? null;

  // ⚠️ `canUndo` is computed against the zones actually on screen and against
  // in-flight writes, not merely against a non-empty history. Two dead-control
  // cases it closes (the silent-success class, #791):
  //   · the entry's zone was deleted from the list, so every tap did nothing
  //     forever while the button stayed enabled;
  //   · a write for that zone is still out, so undo and the drag would race at
  //     the database with no ordering token and the loser would survive only
  //     until a reload.
  const undoable = undoTarget(writes);
  const canUndo =
    undoable !== null &&
    zones.some((zone) => zone.id === undoable.zoneId) &&
    !writes.inFlight.some((w) => w.zoneId === undoable.zoneId);

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

  // One write: tell the reducer, call the action, tell the reducer the outcome.
  // The reducer owns which entry rolls back and what an undo restores; this
  // function owns nothing but the round trip.
  const write = useCallback(
    (zone: CanvasZone, server: ZoneSnapshot, next: ZoneSnapshot, viaUndo: boolean) => {
      setError(null);
      const seq = writeSeq.current + 1;
      writeSeq.current = seq;
      dispatch(viaUndo ? { type: "undo" } : { type: "commit", zoneId: zone.id, server, next });

      const settle = (ok: boolean, message?: string) => {
        dispatch({ type: "settled", seq, ok });
        // Whatever the outcome, the node under the pointer may now disagree
        // with the geometry — on failure it is at the refused position, and on
        // an equal-after-snap success it never moved back. Re-derive it.
        bumpRepaint(zone.id);
        if (!ok) setError(message ?? SAVE_FAILED);
      };

      saveZone({
        projectId,
        mapId,
        zoneId: zone.id,
        code: zone.code,
        name: zone.name,
        shape: next.shape,
        geometry: next.geometry,
      })
        .then((result) => settle(result.ok, result.ok ? undefined : result.error))
        // ⚠️ A REJECTION is not a refusal — a dropped connection, a 500, or a
        // stale action id after a deploy never resolves, so without this the
        // write is never settled: the draft pins the zone forever, the in-flight
        // entry leaks, the shape sits at a position the database never received,
        // and the manager is told nothing. (Plus an unhandled rejection.)
        .catch(() => settle(false));
    },
    [projectId, mapId, bumpRepaint],
  );

  const commit = useCallback(
    (zone: CanvasZone, next: ZoneSnapshot) => {
      const server = zones.find((z) => z.id === zone.id);
      write(zone, server ? { shape: server.shape, geometry: server.geometry } : next, next, false);
    },
    [zones, write],
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

  // Narrowed on the VALUE rather than on a boolean: a `wasPolygon` flag reads
  // the same to a human and tells the compiler nothing, so the `as BoxGeometry`
  // it forces would be the only thing standing between a polygon and
  // `boxToCorners` reading four undefined corners.
  const applyShape = useCallback(
    (zone: CanvasZone, shape: ZoneShape) => {
      const current = zone.geometry;
      const geometry: ZoneGeometry = isPolygon(current)
        ? shape === "polygon"
          ? current
          : cornersToBox(current.points)
        : shape === "polygon"
          ? { points: boxToCorners(current) }
          : current;
      commit(zone, { shape, geometry });
    },
    [commit],
  );

  const handleShapeChange = useCallback(
    (shape: ZoneShape) => {
      if (!selected || shape === selected.shape) return;
      // ⚠️ Collapsing a polygon to a box keeps only its bounding rectangle, and
      // undo is the only way back. An earlier version claimed in a comment that
      // a confirmation covered this; none existed.
      //
      // ⭐ The test is whether the geometry actually CHANGES, not whether there
      // are more than four points: a four-vertex quad that is not a rectangle
      // loses three of its corners to its bounding box, silently, and a point
      // count cannot see that.
      if (
        isPolygon(selected.geometry) &&
        shape !== "polygon" &&
        polygonLosesShape(selected.geometry.points)
      ) {
        setPendingReshape(shape);
        return;
      }
      applyShape(selected, shape);
    },
    [selected, applyShape],
  );

  const handleUndo = useCallback(() => {
    // ⚠️ The reducer only issues a write when it HAS something to undo, so the
    // guard is load-bearing: dispatching `undo` on an empty history is a no-op
    // there while `write` would still have burned a sequence number here, and
    // every later settle would then name a write that does not exist.
    if (!canUndo || !undoable) return;
    const zone = resolved.find((z) => z.id === undoable.zoneId);
    if (!zone) return;
    write(zone, undoable.snapshot, undoable.snapshot, true);
  }, [canUndo, undoable, resolved, write]);

  const toolButton =
    "rounded-control border-edge text-meta focus-visible:ring-action border px-3 py-2 font-medium focus:outline-none focus-visible:ring-2 disabled:opacity-40";

  return (
    <div>
      {!readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* `aria-pressed` is a ternary, not `selected?.shape === tool.shape`:
              that expression is `undefined` with nothing selected, React omits
              the attribute entirely, and the buttons stop being toggles for a
              screen reader in exactly the state where that matters most. */}
          {SHAPE_TOOLS.map((tool) => (
            <button
              key={tool.shape}
              type="button"
              onClick={() => handleShapeChange(tool.shape)}
              disabled={selected === null}
              aria-pressed={selected ? selected.shape === tool.shape : false}
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
            disabled={!canUndo}
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
                  // ⭐ `repaint` is in the key on purpose. A Konva node is a
                  // mutable object the POINTER has already moved; when a drag's
                  // snapped result equals the stored geometry, react-konva sees
                  // identical props and writes nothing back, leaving the shape
                  // under the cursor while the database holds the old value —
                  // and the next transform then reads that drifted position and
                  // bakes it in. Remounting after every settled write forces the
                  // position to be re-derived from the geometry.
                  key={`${zone.id}-${repaint[zone.id] ?? 0}`}
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
                      // Same reason as the shape key above: a vertex handle
                      // dropped within one grid step of where it started keeps
                      // identical props, so without the remount the white dot
                      // sits away from the corner it edits.
                      key={`${selected.id}-${index}-${repaint[selected.id] ?? 0}`}
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

      {/* Spec 18's themed dialog, not `window.confirm` — which the design
          doctrine bans outright and which the suite caught here. The message
          names the count so the cost is concrete rather than abstract. */}
      <ConfirmDialog
        open={pendingReshape !== null}
        message={
          selected && isPolygon(selected.geometry)
            ? `เปลี่ยนเป็นรูปทรงนี้จะเหลือเฉพาะกรอบสี่เหลี่ยมที่ครอบโซนอยู่ — จุดมุมที่วาดไว้ ${selected.geometry.points.length} จุดจะหายไป`
            : ""
        }
        confirmLabel="เปลี่ยนรูปทรง"
        onConfirm={() => {
          if (selected && pendingReshape) applyShape(selected, pendingReshape);
          setPendingReshape(null);
        }}
        onCancel={() => setPendingReshape(null)}
      />
    </div>
  );
}
