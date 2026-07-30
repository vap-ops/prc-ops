"use client";

// Spec 141 U2 — equipment management UI (/equipment, back-office). Writes go
// through the equipment server actions (RLS client; no money here —
// acquisition_cost is admin-only and not surfaced). The U1 validateEquipmentItem
// gives friendly, Thai, client-side errors before the action re-checks.
//
// Spec 362 U1 — READ-first, ported from /catalog (catalog-list.tsx). The page
// used to open on FOUR curator blocks (2 quick-adds, the taxonomy card, the add
// form) stacked above 64 items that had no search, no filter and no grouping.
// Now it opens on the data — search, counted category chips, `label (n)`
// sections, card rows — and every write lives one tap away inside a BottomSheet.
//
// The money audience is deliberately UNCHANGED: SetDailyRate stays in the ROW's
// control cluster and is NOT moved into the edit sheet. `dailyRate` distinguishes
// `undefined` (not the money audience → render nothing) from `null` (audience,
// rate unset) through a conditional prop spread under exactOptionalPropertyTypes;
// every extra hop is a chance to flatten that into "unset" and render the control
// to the field view, so this port adds no hop at all.
//
// 'use client' justification: the search + category filter state, the sheet open
// states, and the add/edit forms' busy/error state + the unit|bulk tracking
// toggle that swaps the asset-tag/quantity field.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { RadioChip } from "@/components/features/common/radio-chip";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { EditCategoryRow } from "./edit-category-row";
import {
  BUTTON_PRIMARY,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  FIELD_INPUT,
  FIELD_STACKED,
} from "@/lib/ui/classes";
import {
  validateEquipmentItem,
  type EquipmentTracking,
} from "@/lib/equipment/validate-equipment-item";
import {
  currentEquipmentLocation,
  type EquipmentMovementRecord,
  type EquipmentMovementKind,
} from "@/lib/equipment/current-location";
import { equipmentLocationLabel } from "@/lib/equipment/equipment-location-label";
import { EquipmentHistorySheet } from "@/components/features/equipment/equipment-history-sheet";
import { EquipmentPhotoSlots } from "@/components/features/equipment/equipment-photo-slots";
import { photoCompleteness, type EquipmentPhotoKind } from "@/lib/equipment/photo-kinds";
import { pickDefaultOwnerId, type OwnerOption } from "@/lib/equipment/default-owner";
import {
  EQUIPMENT_MOVEMENT_KIND_LABEL,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_TRACKING_LABEL,
} from "@/lib/i18n/labels";
import { SetDailyRate } from "@/components/features/equipment/set-daily-rate";
import {
  createEquipment,
  createEquipmentCategory,
  createEquipmentOwner,
  recordEquipmentMovement,
  updateEquipment,
} from "@/app/equipment/actions";
import type { Database } from "@/lib/db/database.types";

type EquipmentStatus = Database["public"]["Enums"]["equipment_status"];

// The page maps DB equipment_movements rows into the helper's record shape.
export type EquipmentMovementRow = EquipmentMovementRecord;

// Move-form kind order: the two common field actions first, then the rest.
const MOVEMENT_KIND_ORDER: ReadonlyArray<EquipmentMovementKind> = [
  "deployed",
  "returned",
  "received",
  "maintenance",
  "lost",
];

export type ManagedEquipmentItem = {
  id: string;
  name: string;
  category_id: string;
  owner_id: string;
  tracking: EquipmentTracking;
  asset_tag: string | null;
  quantity: number | null;
  status: EquipmentStatus;
};

type Ref = { id: string; name: string };

// Spec 367 U1: these labels moved to the labels.ts SSOT (the CSV importer maps
// Thai → enum and cannot import from a component). Aliased rather than renamed
// at ~4 call sites so the diff stays about the move.
const STATUS_LABELS = EQUIPMENT_STATUS_LABEL;

// The PICKER's options — deliberately NOT every value of the enum.
//
// `disposed` (spec 367 U1) is missing on purpose: an asset becomes disposed by
// being SOLD, which the spec 367 §3 PRI-transfer flow records along with the
// counterparty and the book value. Offering it as a free-hand dropdown choice
// would let someone retire an asset with no transfer behind it. The LABEL map
// above still covers it, so a row already in that state renders correctly
// wherever it is read — coverage without an affordance.
const STATUS_ORDER: ReadonlyArray<EquipmentStatus> = [
  "available",
  "on_site",
  "in_use",
  "maintenance",
  "returned",
  "lost",
];

/** Spec 362 U1 — the "no category filter" chip value (the /catalog sentinel). */
const ALL = "all";

// Spec 367 U1 — derived from the labels.ts SSOT instead of re-typing the pair.
const TRACKING_OPTIONS = [
  { value: "unit", label: EQUIPMENT_TRACKING_LABEL.unit },
  { value: "bulk", label: EQUIPMENT_TRACKING_LABEL.bulk },
] as const;

// Shared field block for the add + edit forms (name/category/owner/tracking/
// asset-tag-or-quantity/status). Controlled by the parent's state.
function EquipmentFields({
  idPrefix,
  categories,
  owners,
  name,
  setName,
  categoryId,
  setCategoryId,
  ownerId,
  setOwnerId,
  tracking,
  setTracking,
  assetTag,
  setAssetTag,
  quantity,
  setQuantity,
  status,
  setStatus,
}: {
  idPrefix: string;
  categories: Ref[];
  owners: OwnerOption[];
  name: string;
  setName: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  ownerId: string;
  setOwnerId: (v: string) => void;
  tracking: EquipmentTracking;
  setTracking: (v: EquipmentTracking) => void;
  assetTag: string;
  setAssetTag: (v: string) => void;
  quantity: string;
  setQuantity: (v: string) => void;
  status: EquipmentStatus;
  setStatus: (v: EquipmentStatus) => void;
}) {
  return (
    <>
      <label className="text-ink-secondary mt-2 block text-sm">
        ชื่ออุปกรณ์
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className={FIELD_STACKED}
        />
      </label>
      {/* ⚠️ Do NOT add `appearance-none` to these selects. FIELD_STACKED is an
          INPUT class, so with the native chevron suppressed a picker renders
          pixel-identical to a text box — the operator read the prefilled owner as
          typed text and reported the field as "text, not a selection"
          (2026-07-30), which is also why nobody would think to tap it.
          `appearance-none` IS right on a date input (it tames iOS's native date
          chrome, as /accounting and /requests use it); on a select it deletes the
          control's only affordance. Pinned in
          tests/unit/equipment-select-affordance.test.tsx. */}
      <label className="text-ink-secondary mt-2 block text-sm">
        หมวดหมู่
        <select
          aria-label="หมวดหมู่"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={FIELD_STACKED}
        >
          <option value="">— เลือกหมวดหมู่ —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-ink-secondary mt-2 block text-sm">
        เจ้าของ
        <select
          aria-label="เจ้าของ"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className={FIELD_STACKED}
        >
          <option value="">— เลือกเจ้าของ —</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {/* flex-wrap: RadioChips are unwrappable by contract (#235 guard) — a
          no-wrap row of these long labels would overflow a 375px phone. */}
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="ประเภทการติดตาม">
        {TRACKING_OPTIONS.map((option) => (
          <RadioChip
            key={option.value}
            name={`${idPrefix}-tracking`}
            label={option.label}
            checked={tracking === option.value}
            onSelect={() => setTracking(option.value)}
          />
        ))}
      </div>
      {tracking === "unit" ? (
        <label className="text-ink-secondary mt-2 block text-sm">
          รหัสครุภัณฑ์
          <input
            value={assetTag}
            onChange={(e) => setAssetTag(e.target.value)}
            maxLength={80}
            placeholder="ไม่บังคับ"
            className={FIELD_STACKED}
          />
        </label>
      ) : (
        <label className="text-ink-secondary mt-2 block text-sm">
          จำนวน
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="numeric"
            className={FIELD_STACKED}
          />
        </label>
      )}
      <label className="text-ink-secondary mt-2 block text-sm">
        สถานะ
        <select
          aria-label="สถานะ"
          value={status}
          onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
          className={FIELD_STACKED}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function buildItemArgs(
  name: string,
  tracking: EquipmentTracking,
  assetTag: string,
  quantity: string,
) {
  return {
    name,
    tracking,
    assetTag: tracking === "unit" ? assetTag : "",
    quantity: tracking === "bulk" ? (quantity.trim() === "" ? Number.NaN : Number(quantity)) : null,
  };
}

function AddEquipmentForm({
  categories,
  owners,
  onDone,
}: {
  categories: Ref[];
  owners: OwnerOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  // Spec 367 U5b — the item id is minted HERE, before the row exists, because the
  // photo has to be uploaded to `<itemId>/…` (the depth-1 arm of the
  // equipment-images policy) and there is no id to use yet. Same id then goes to
  // createEquipment, so the row owns the folder its photo landed in. Minted once
  // per mount: the sheet unmounts on save, so the next open gets a fresh one.
  const [draftId] = useState(() => crypto.randomUUID());
  const [draftPhotos, setDraftPhotos] = useState<Partial<Record<EquipmentPhotoKind, string>>>({});
  // Operator ask 2026-07-30 — the fleet has one standing owner (PRI), so the
  // form starts there instead of on the sentinel. Read from the data
  // (`equipment_owners.is_default`), never from a name: spec 367 §3 is about the
  // plant changing hands. Falls back to "" — the "— เลือกเจ้าของ —" option, which
  // keeps the submit button disabled — when nothing is flagged.
  const defaultOwnerId = pickDefaultOwnerId(owners);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [tracking, setTracking] = useState<EquipmentTracking>("unit");
  const [assetTag, setAssetTag] = useState("");
  const [quantity, setQuantity] = useState("");
  const [status, setStatus] = useState<EquipmentStatus>("available");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const args = buildItemArgs(name, tracking, assetTag, quantity);
    const valid = validateEquipmentItem(args);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }
    setBusy(true);
    const result = await createEquipment({
      id: draftId,
      photos: Object.entries(draftPhotos).map(([kind, path]) => ({ kind, path })),
      name,
      categoryId,
      ownerId,
      tracking,
      assetTag: args.assetTag,
      quantity: args.quantity,
      status,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setAssetTag("");
    setQuantity("");
    setTracking("unit");
    setStatus("available");
    setCategoryId("");
    // Mirrors the initial state rather than the sentinel — clearing it here
    // would contradict what the next open shows. Unobservable today (BottomSheet
    // returns null when closed, so onDone() unmounts this form and useState
    // re-seeds it), which is why no test pins it; it is kept in step with its
    // six sibling resets rather than left as the one that says "".
    setOwnerId(defaultOwnerId);
    setDraftPhotos({});
    onDone();
    router.refresh();
  }

  return (
    <div>
      {/* Spec 382 U2 — photograph the machine while adding it: four slots with
          drawn guides, all optional. Draft mode uploads under draftId and the
          paths ride along to createEquipment, so no second visit is needed. */}
      <EquipmentPhotoSlots
        itemId={draftId}
        onDraftChange={(kind, path) =>
          setDraftPhotos((prev) => {
            const next = { ...prev };
            if (path === null) delete next[kind];
            else next[kind] = path;
            return next;
          })
        }
      />
      <EquipmentFields
        idPrefix="equip-add"
        categories={categories}
        owners={owners}
        name={name}
        setName={setName}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        ownerId={ownerId}
        setOwnerId={setOwnerId}
        tracking={tracking}
        setTracking={setTracking}
        assetTag={assetTag}
        setAssetTag={setAssetTag}
        quantity={quantity}
        setQuantity={setQuantity}
        status={status}
        setStatus={setStatus}
      />
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || name.trim() === "" || categoryId === "" || ownerId === ""}
        onClick={() => void submit()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
      >
        เพิ่มรายการ
      </button>
    </div>
  );
}

// U4 — record a movement (deploy to a project / return / maintenance / lost).
// 'deployed' is the only kind that carries a project (the DB CHECK enforces
// project_id IFF deployed); bulk items carry a quantity, unit items move as one.
function MoveEquipmentForm({
  item,
  projects,
  onDone,
}: {
  item: ManagedEquipmentItem;
  projects: Ref[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<EquipmentMovementKind>("deployed");
  const [projectId, setProjectId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const qty = item.tracking === "bulk" ? Number(quantity) : 1;
    if (item.tracking === "bulk" && (!Number.isInteger(qty) || qty < 1)) {
      setError("จำนวนที่ย้ายต้องเป็นจำนวนเต็มอย่างน้อย 1");
      return;
    }
    setBusy(true);
    const result = await recordEquipmentMovement({
      itemId: item.id,
      kind,
      projectId: kind === "deployed" ? projectId : null,
      quantity: qty,
      note,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <div className="border-edge-strong bg-page mt-2 rounded-lg border p-3">
      <label className="text-ink-secondary block text-sm">
        ประเภทการเคลื่อนย้าย
        <select
          aria-label="ประเภทการเคลื่อนย้าย"
          value={kind}
          onChange={(e) => setKind(e.target.value as EquipmentMovementKind)}
          className={FIELD_STACKED}
        >
          {MOVEMENT_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {EQUIPMENT_MOVEMENT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {kind === "deployed" ? (
        <label className="text-ink-secondary mt-2 block text-sm">
          โครงการ
          <select
            aria-label="โครงการ"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={FIELD_STACKED}
          >
            <option value="">— เลือกโครงการ —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {item.tracking === "bulk" ? (
        <label className="text-ink-secondary mt-2 block text-sm">
          จำนวนที่ย้าย
          <input
            aria-label="จำนวนที่ย้าย"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="numeric"
            className={FIELD_STACKED}
          />
        </label>
      ) : null}
      <label className="text-ink-secondary mt-2 block text-sm">
        หมายเหตุ
        <input
          aria-label="หมายเหตุ"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder="ไม่บังคับ"
          className={FIELD_STACKED}
        />
      </label>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || (kind === "deployed" && projectId === "")}
          onClick={() => void submit()}
          className={BUTTON_PRIMARY_COMPACT}
        >
          บันทึกการย้าย
        </button>
        <button type="button" onClick={onDone} className={BUTTON_SECONDARY_COMPACT}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

function EquipmentRow({
  item,
  categories,
  owners,
  projects,
  ownerName,
  locationLabel,
  canManageRegistry,
  dailyRate,
  photos,
}: {
  item: ManagedEquipmentItem;
  categories: Ref[];
  owners: OwnerOption[];
  projects: Ref[];
  ownerName: string | null;
  locationLabel: string;
  canManageRegistry: boolean;
  // Spec 202 U1 — present ONLY for the money audience (page omits it otherwise).
  // `undefined` = not the money audience → no rate control renders. MONEY.
  dailyRate?: number | null;
  // Spec 382 U2 — which of the four slots are filled, with a 120s signed URL for
  // each (minted by the page; equipment-images is private, so a raw path renders
  // nothing). The KINDS drive the n/4 chip and the URLs drive the thumbnails —
  // kept together so a slot whose URL failed to mint still counts as filled.
  photos?: { kind: EquipmentPhotoKind; url?: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.category_id);
  const [ownerId, setOwnerId] = useState(item.owner_id);
  const [tracking, setTracking] = useState<EquipmentTracking>(item.tracking);
  const [assetTag, setAssetTag] = useState(item.asset_tag ?? "");
  const [quantity, setQuantity] = useState(item.quantity != null ? String(item.quantity) : "");
  const [status, setStatus] = useState<EquipmentStatus>(item.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const args = buildItemArgs(name, tracking, assetTag, quantity);
    const valid = validateEquipmentItem(args);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }
    setBusy(true);
    const result = await updateEquipment({
      id: item.id,
      name,
      categoryId,
      ownerId,
      tracking,
      assetTag: args.assetTag,
      quantity: args.quantity,
      status,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const placement =
    item.tracking === "bulk"
      ? `${(item.quantity ?? 0).toLocaleString("th-TH")} หน่วย`
      : (item.asset_tag ?? "ไม่มีรหัส");

  const photoCount = photoCompleteness((photos ?? []).map((p) => p.kind));

  // Spec 362 U1 — the /catalog card row. The name block is floored at min-w-40
  // (NOT min-w-0) with a wrapping row: the fixed control cluster would otherwise
  // squeeze the name to one character per line on a phone (feedback 65de06ca).
  // The category is NOT repeated here — the section heading above the row is its
  // category, and every item has exactly one (equipment_items.category_id is NOT
  // NULL), so a per-row badge would be pure duplication.
  return (
    <li className="border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3">
      <span className="min-w-40 flex-1">
        <span className="text-ink text-body block font-semibold">{item.name}</span>
        <span className="text-ink-secondary text-meta block">
          {STATUS_LABELS[item.status]} · {placement}
          {ownerName ? ` · ${ownerName}` : ""}
        </span>
        <span className="text-ink-muted text-meta block">
          <span aria-hidden="true">📍 </span>
          <span>{locationLabel}</span>
        </span>
        {/* Spec 382 U2 — completeness, never a blocker. Photos are optional by
            operator ruling, so this REPORTS the gap rather than refusing the
            save; it is also the PRI-transfer readiness number, per item. Muted
            at 4/4 so a finished item stops asking for attention. */}
        <span
          className={
            photoCount.have === photoCount.total
              ? "text-ink-muted text-meta block"
              : "text-ink-secondary text-meta block font-medium"
          }
        >
          <span aria-hidden="true">🖼 </span>
          <span>{`รูป ${photoCount.have}/${photoCount.total}`}</span>
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setMoving(true);
            setEditing(false);
          }}
          className={BUTTON_SECONDARY_COMPACT}
        >
          ย้าย
        </button>
        {canManageRegistry ? (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setMoving(false);
            }}
            className={BUTTON_SECONDARY_COMPACT}
          >
            แก้ไข
          </button>
        ) : null}
        {/* MONEY: `undefined` means "not the money audience" and renders nothing.
            Stays in the row — see the file header on why it must not travel. */}
        {/* Spec 381 U2 — the third control in the cluster. Shown to the whole
            row audience, not just curators: the site_admin who moved the tool is
            the person most likely to ask where it went, and the RPC omits the
            money events for her. It fetches only when tapped. */}
        <EquipmentHistorySheet itemId={item.id} itemName={item.name} />
        {dailyRate !== undefined ? <SetDailyRate itemId={item.id} currentRate={dailyRate} /> : null}
      </span>

      <BottomSheet open={moving} title="ย้ายอุปกรณ์" onClose={() => setMoving(false)}>
        <MoveEquipmentForm item={item} projects={projects} onDone={() => setMoving(false)} />
      </BottomSheet>

      <BottomSheet open={editing} title="แก้ไขอุปกรณ์" onClose={() => setEditing(false)}>
        <div>
          {/* Spec 382 U2 — first in the sheet: the pictures are how someone
              recognises the machine, and every field below describes the same
              object. The sheet sits behind the canManageRegistry-gated แก้ไข
              button, the same audience the storage policy and the action admit,
              so it carries no gate of its own. */}
          <EquipmentPhotoSlots
            itemId={item.id}
            thumbnails={Object.fromEntries(
              (photos ?? []).filter((p) => p.url).map((p) => [p.kind, p.url!]),
            )}
          />
          <EquipmentFields
            idPrefix={`equip-edit-${item.id}`}
            categories={categories}
            owners={owners}
            name={name}
            setName={setName}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            ownerId={ownerId}
            setOwnerId={setOwnerId}
            tracking={tracking}
            setTracking={setTracking}
            assetTag={assetTag}
            setAssetTag={setAssetTag}
            quantity={quantity}
            setQuantity={setQuantity}
            status={status}
            setStatus={setStatus}
          />
          {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className={BUTTON_PRIMARY_COMPACT}
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={BUTTON_SECONDARY_COMPACT}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      </BottomSheet>
    </li>
  );
}

function QuickAddCategory() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const result = await createEquipmentCategory({ name });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <div>
      <label className="text-ink-secondary block text-sm">
        ชื่อหมวดหมู่ใหม่
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="เช่น รถขุด เครื่องปั่นไฟ นั่งร้าน"
          className={FIELD_STACKED}
        />
      </label>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || name.trim() === ""}
        onClick={() => void submit()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
      >
        เพิ่มหมวดหมู่
      </button>
    </div>
  );
}

function QuickAddOwner() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const result = await createEquipmentOwner({ name, phone });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setPhone("");
    router.refresh();
  }

  return (
    <div>
      <label className="text-ink-secondary block text-sm">
        ชื่อเจ้าของใหม่
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="เช่น บริษัทพี่น้อง"
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-2 block text-sm">
        เบอร์โทร
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={40}
          inputMode="tel"
          placeholder="ไม่บังคับ"
          className={FIELD_STACKED}
        />
      </label>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || name.trim() === ""}
        onClick={() => void submit()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
      >
        เพิ่มเจ้าของ
      </button>
    </div>
  );
}

export function EquipmentManager({
  items,
  categories,
  owners,
  projects,
  movements,
  canManageRegistry,
  dailyRates,
  photosByItem,
}: {
  items: ManagedEquipmentItem[];
  categories: Ref[];
  owners: OwnerOption[];
  projects: Ref[];
  movements: EquipmentMovementRow[];
  // U5 — false for the site_admin field view: list + where-is-it + move only,
  // no registry editing (add/edit items, bootstrap categories/owners). RLS is
  // the real guard; this just hides the affordances the field can't use.
  canManageRegistry: boolean;
  // Spec 202 U1 — the per-item daily charge-out rate map (id → baht/day | null).
  // MONEY: present ONLY when the page resolved the back-office money audience; the
  // field view (site_admin) never receives it, so no rate ever reaches that client.
  dailyRates?: Record<string, number | null>;
  // Spec 382 U2 — itemId → the slots that are filled, each with a 120s signed URL
  // where one could be minted. equipment-images is private, so a raw storage path
  // would render nothing; the KIND list is what the n/4 chip counts, so a slot
  // whose URL failed to mint still reads as filled rather than vanishing.
  photosByItem?: Record<string, { kind: EquipmentPhotoKind; url?: string }[]>;
}) {
  const ownerNames = new Map(owners.map((o) => [o.id, o.name]));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const locations = currentEquipmentLocation(movements);
  // Belt-and-braces: only surface rates when BOTH the audience flag and the map
  // are present (a rate map must never render on the field view).
  const canPriceEquipment = canManageRegistry && dailyRates !== undefined;

  const [query, setQuery] = useState("");
  const [selectedCat, setSelectedCat] = useState<string>(ALL);
  const [addingItem, setAddingItem] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);

  // Spec 362 U1 — search over the two things a curator actually knows about a
  // machine: what it's called, and the tag stencilled on it.
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const queried = !searching
    ? items
    : items.filter((it) => `${it.name} ${it.asset_tag ?? ""}`.toLowerCase().includes(q));

  const catName = (id: string) => categoryNames.get(id) ?? id;
  const countIn = (id: string) => queried.filter((it) => it.category_id === id).length;
  // Category order follows the `categories` prop (the page orders it by name);
  // a category with no matching row this render is not offered as a chip.
  const present = categories.map((c) => c.id).filter((id) => countIn(id) > 0);

  // A live search OVERRIDES the category chip and searches the whole registry
  // (the /catalog rule, catalog-list.tsx:110). Typing a name you can see is a
  // stronger statement of intent than a chip you tapped a minute ago, and a
  // search that silently returned nothing because of a stuck filter is the
  // worse failure. The chip stays checked, so clearing the box restores it.
  const sections =
    !searching && selectedCat !== ALL
      ? present
          .filter((id) => id === selectedCat)
          .map((id) => ({ id, rows: queried.filter((it) => it.category_id === id) }))
      : present.map((id) => ({ id, rows: queried.filter((it) => it.category_id === id) }));

  const curatorDoors = canManageRegistry ? (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setManagingCategories(true)}
          className="text-action inline-flex min-h-11 items-center text-sm font-medium hover:underline"
        >
          หมวดหมู่
        </button>
        <button
          type="button"
          onClick={() => setAddingOwner(true)}
          className="text-action inline-flex min-h-11 items-center text-sm font-medium hover:underline"
        >
          เจ้าของ
        </button>
      </div>
      <button type="button" onClick={() => setAddingItem(true)} className={BUTTON_PRIMARY}>
        เพิ่มอุปกรณ์
      </button>
    </div>
  ) : null;

  const curatorSheets = canManageRegistry ? (
    <>
      <BottomSheet
        open={addingItem}
        title="เพิ่มรายการอุปกรณ์"
        onClose={() => setAddingItem(false)}
      >
        <AddEquipmentForm
          categories={categories}
          owners={owners}
          onDone={() => setAddingItem(false)}
        />
      </BottomSheet>

      {/* Spec 361 U6 — add a category and fix an existing one live together:
          renaming a category with equipment in it is a different decision from
          renaming an empty one, so the counts stay beside the rename. */}
      <BottomSheet
        open={managingCategories}
        title="หมวดหมู่อุปกรณ์"
        onClose={() => setManagingCategories(false)}
      >
        <QuickAddCategory />
        {categories.length > 0 ? (
          <ul className="border-edge mt-4 flex flex-col border-t pt-2">
            {categories.map((c) => (
              <EditCategoryRow
                key={c.id}
                category={c}
                itemCount={items.filter((it) => it.category_id === c.id).length}
              />
            ))}
          </ul>
        ) : null}
      </BottomSheet>

      <BottomSheet open={addingOwner} title="เจ้าของอุปกรณ์" onClose={() => setAddingOwner(false)}>
        <QuickAddOwner />
      </BottomSheet>
    </>
  ) : null;

  // An empty registry shows its door and its reason — never a search box over
  // nothing (the /catalog early-return shape).
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {curatorDoors}
        <p className="text-ink-secondary text-body">
          {canManageRegistry
            ? "ยังไม่มีอุปกรณ์ — เพิ่มหมวดหมู่และเจ้าของก่อน แล้วจึงเพิ่มอุปกรณ์"
            : "ยังไม่มีอุปกรณ์ในระบบ"}
        </p>
        {curatorSheets}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {curatorDoors}

      <div className="relative">
        <Search
          aria-hidden
          className="text-ink-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${FIELD_INPUT} pl-10`}
          placeholder="ค้นหาด้วยชื่อ หรือรหัสครุภัณฑ์ (เช่น GEN-001)"
          aria-label="ค้นหาอุปกรณ์"
          autoComplete="off"
        />
      </div>

      <div
        className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto pb-1"
        role="radiogroup"
        aria-label="กรองตามหมวดหมู่"
      >
        <RadioChip
          name="equipment-category"
          label={`ทั้งหมด (${queried.length})`}
          checked={selectedCat === ALL}
          onSelect={() => setSelectedCat(ALL)}
        />
        {present.map((id) => (
          <RadioChip
            key={id}
            name="equipment-category"
            label={`${catName(id)} (${countIn(id)})`}
            checked={selectedCat === id}
            onSelect={() => setSelectedCat(id)}
          />
        ))}
      </div>

      {searching && queried.length === 0 ? (
        <p className="text-ink-secondary text-body">ไม่พบอุปกรณ์ที่ค้นหา</p>
      ) : null}

      <div className="flex flex-col gap-6">
        {sections.map((sec) => (
          <section key={sec.id} className="flex flex-col gap-2">
            <h2 className="text-meta text-ink-secondary font-semibold">
              {catName(sec.id)} <span className="text-ink-muted">({sec.rows.length})</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {sec.rows.map((it) => {
                const loc = locations.get(it.id);
                const projectName = loc?.projectId
                  ? (projectNames.get(loc.projectId) ?? null)
                  : null;
                return (
                  <EquipmentRow
                    key={it.id}
                    item={it}
                    categories={categories}
                    owners={owners}
                    projects={projects}
                    ownerName={ownerNames.get(it.owner_id) ?? null}
                    locationLabel={equipmentLocationLabel(loc, projectName)}
                    canManageRegistry={canManageRegistry}
                    {...(canPriceEquipment ? { dailyRate: dailyRates![it.id] ?? null } : {})}
                    {...(photosByItem?.[it.id] ? { photos: photosByItem[it.id]! } : {})}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {curatorSheets}
    </div>
  );
}
