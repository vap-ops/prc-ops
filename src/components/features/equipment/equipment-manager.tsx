"use client";

// Spec 141 U2 — equipment management UI (/equipment, back-office). Mirrors the
// worker roster: a quick-add card pair (category + owner) to bootstrap the
// masters, an add-item form, and per-item inline edit. Writes go through the
// equipment server actions (RLS client; no money here — acquisition_cost is
// admin-only and not surfaced). The U1 validateEquipmentItem gives friendly,
// Thai, client-side errors before the action re-checks.
//
// 'use client' justification: add/edit forms with busy/error states + the
// unit|bulk tracking toggle that swaps the asset-tag/quantity field.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RadioChip } from "@/components/features/common/radio-chip";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
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
import { EQUIPMENT_MOVEMENT_KIND_LABEL } from "@/lib/i18n/labels";
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

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: "พร้อมใช้งาน",
  on_site: "อยู่หน้างาน",
  in_use: "กำลังใช้งาน",
  maintenance: "ซ่อมบำรุง",
  returned: "คืนแล้ว",
  lost: "สูญหาย",
};

const STATUS_ORDER: ReadonlyArray<EquipmentStatus> = [
  "available",
  "on_site",
  "in_use",
  "maintenance",
  "returned",
  "lost",
];

const TRACKING_OPTIONS = [
  { value: "unit", label: "รายชิ้น (มีรหัส)" },
  { value: "bulk", label: "จำนวนมาก (นับจำนวน)" },
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
  owners: Ref[];
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
      <label className="text-ink-secondary mt-2 block text-sm">
        หมวดหมู่
        <select
          aria-label="หมวดหมู่"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={`${FIELD_STACKED} appearance-none`}
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
          className={`${FIELD_STACKED} appearance-none`}
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
          className={`${FIELD_STACKED} appearance-none`}
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

function AddEquipmentForm({ categories, owners }: { categories: Ref[]; owners: Ref[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ownerId, setOwnerId] = useState("");
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
    setOwnerId("");
    router.refresh();
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เพิ่มอุปกรณ์</p>
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
        เพิ่มอุปกรณ์
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
          className={`${FIELD_STACKED} appearance-none`}
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
            className={`${FIELD_STACKED} appearance-none`}
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
  categoryName,
  locationLabel,
  canManageRegistry,
  dailyRate,
}: {
  item: ManagedEquipmentItem;
  categories: Ref[];
  owners: Ref[];
  projects: Ref[];
  ownerName: string | null;
  categoryName: string | null;
  locationLabel: string;
  canManageRegistry: boolean;
  // Spec 202 U1 — present ONLY for the money audience (page omits it otherwise).
  // `undefined` = not the money audience → no rate control renders. MONEY.
  dailyRate?: number | null;
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

  return (
    <li className="border-edge border-t py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink truncate text-sm">
            {item.name}
            {ownerName ? (
              <span className="text-ink-muted ml-1.5 text-xs">· {ownerName}</span>
            ) : null}
          </p>
          <p className="text-ink-secondary text-xs">
            {STATUS_LABELS[item.status]} · {placement}
            {categoryName ? ` · ${categoryName}` : ""}
          </p>
          <p className="text-ink-muted text-xs">
            <span aria-hidden="true">📍 </span>
            <span>{locationLabel}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => {
              setMoving((v) => !v);
              setEditing(false);
            }}
            className="text-action text-xs font-medium hover:underline"
          >
            ย้าย
          </button>
          {canManageRegistry ? (
            <button
              type="button"
              onClick={() => {
                setEditing((v) => !v);
                setMoving(false);
              }}
              className="text-action text-xs font-medium hover:underline"
            >
              แก้ไข
            </button>
          ) : null}
          {dailyRate !== undefined ? (
            <SetDailyRate itemId={item.id} currentRate={dailyRate} />
          ) : null}
        </div>
      </div>
      {moving ? (
        <MoveEquipmentForm item={item} projects={projects} onDone={() => setMoving(false)} />
      ) : null}
      {editing ? (
        <div className="border-edge-strong bg-page mt-2 rounded-lg border p-3">
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
      ) : null}
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
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เพิ่มหมวดหมู่</p>
      <label className="text-ink-secondary mt-2 block text-sm">
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
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เพิ่มเจ้าของอุปกรณ์</p>
      <label className="text-ink-secondary mt-2 block text-sm">
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
}: {
  items: ManagedEquipmentItem[];
  categories: Ref[];
  owners: Ref[];
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
}) {
  const ownerNames = new Map(owners.map((o) => [o.id, o.name]));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const locations = currentEquipmentLocation(movements);
  // Belt-and-braces: only surface rates when BOTH the audience flag and the map
  // are present (a rate map must never render on the field view).
  const canPriceEquipment = canManageRegistry && dailyRates !== undefined;

  return (
    <div className="flex flex-col gap-4">
      {canManageRegistry ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <QuickAddCategory />
            <QuickAddOwner />
          </div>
          <AddEquipmentForm categories={categories} owners={owners} />
        </>
      ) : null}
      {items.length > 0 ? (
        <div className={CARD}>
          <p className="text-ink text-sm font-semibold">อุปกรณ์ทั้งหมด</p>
          <ul className="mt-2 flex flex-col">
            {items.map((it) => {
              const loc = locations.get(it.id);
              const projectName = loc?.projectId ? (projectNames.get(loc.projectId) ?? null) : null;
              return (
                <EquipmentRow
                  key={it.id}
                  item={it}
                  categories={categories}
                  owners={owners}
                  projects={projects}
                  ownerName={ownerNames.get(it.owner_id) ?? null}
                  categoryName={categoryNames.get(it.category_id) ?? null}
                  locationLabel={equipmentLocationLabel(loc, projectName)}
                  canManageRegistry={canManageRegistry}
                  {...(canPriceEquipment ? { dailyRate: dailyRates![it.id] ?? null } : {})}
                />
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-ink-secondary text-sm">
          {canManageRegistry
            ? "ยังไม่มีอุปกรณ์ — เพิ่มหมวดหมู่และเจ้าของก่อน แล้วจึงเพิ่มอุปกรณ์"
            : "ยังไม่มีอุปกรณ์ในระบบ"}
        </p>
      )}
    </div>
  );
}
