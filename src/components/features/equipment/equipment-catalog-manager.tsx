"use client";

// Spec 385 U3a — the ทะเบียนเครื่องมือ surface. Before this page the catalog
// (39 SKUs) had NO surface: both ข้อมูลหลัก doors dumped into the per-unit
// /equipment page (operator: "หมวดอุปกรณ์ and ทะเบียนอุปกรณ์ are mixed up to
// อุปกรณ์ item"). Curation here is TYPE-grain: rename, recategorise,
// brand/model, deactivate/reactivate, register a new SKU — and the category
// quick-add lives here now, because a category is a property of the TYPE.
//
// NO MONEY on this surface: default_daily_rate has no authenticated grant in
// any direction, and the rate editor is U3b's DEFINER RPC. Rendering a rate
// column here would silently read nothing (the worker_level_rates class).
//
// 'use client' justification: sheet open/edit state, the busy/error state of
// the three curation actions.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RadioChip } from "@/components/features/common/radio-chip";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { EditCategoryRow } from "./edit-category-row";
import {
  BUTTON_PRIMARY,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  FIELD_STACKED,
} from "@/lib/ui/classes";
import { groupSkusByCategory, type CatalogSkuOption } from "@/lib/equipment/catalog-pick";
import { EQUIPMENT_CATEGORY_MENU_LABEL, EQUIPMENT_TRACKING_LABEL } from "@/lib/i18n/labels";
import {
  createEquipmentCatalogItem,
  createEquipmentCategory,
  setEquipmentCatalogItemActive,
  updateEquipmentCatalogItem,
} from "@/app/equipment/actions";

export type CatalogSkuRowData = CatalogSkuOption & { isActive: boolean };

type Ref = { id: string; name: string };

const TRACKING_OPTIONS = [
  { value: "unit", label: EQUIPMENT_TRACKING_LABEL.unit },
  { value: "bulk", label: EQUIPMENT_TRACKING_LABEL.bulk },
] as const;

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
          placeholder="ตามลักษณะงาน เช่น เครื่องมือลม งานไฟฟ้า"
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

function AddSkuForm({ categories, onDone }: { categories: Ref[]; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tracking, setTracking] = useState<"unit" | "bulk">("unit");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const result = await createEquipmentCatalogItem({ name, categoryId, tracking });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <div>
      <p className="text-ink-secondary text-sm">
        1 ชนิด/รุ่น มี 1 แถวในทะเบียน — เครื่องจริงไปเพิ่มที่หน้าอุปกรณ์โดยเลือกจากทะเบียนนี้
      </p>
      <label className="text-ink-secondary mt-2 block text-sm">
        ชื่อรายการ
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
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="ประเภทการติดตาม">
        {TRACKING_OPTIONS.map((option) => (
          <RadioChip
            key={option.value}
            name="catalog-add-tracking"
            label={option.label}
            checked={tracking === option.value}
            onSelect={() => setTracking(option.value)}
          />
        ))}
      </div>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || name.trim() === "" || categoryId === ""}
        onClick={() => void submit()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
      >
        บันทึกเข้าทะเบียน
      </button>
    </div>
  );
}

function SkuRow({
  sku,
  categories,
  instanceCount,
}: {
  sku: CatalogSkuRowData;
  categories: Ref[];
  instanceCount: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sku.name);
  const [categoryId, setCategoryId] = useState(sku.categoryId);
  const [brand, setBrand] = useState(sku.brand ?? "");
  const [model, setModel] = useState(sku.model ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    const result = await updateEquipmentCatalogItem({ id: sku.id, name, categoryId, brand, model });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setError(null);
    setBusy(true);
    const result = await setEquipmentCatalogItemActive({ id: sku.id, active: !sku.isActive });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <li className="border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3">
      <span className="min-w-40 flex-1">
        <span className="text-ink text-body block font-semibold">{sku.name}</span>
        <span className="text-ink-secondary text-meta block">
          {EQUIPMENT_TRACKING_LABEL[sku.defaultTracking]}
          {sku.brand ? ` · ${sku.brand}` : ""}
          {sku.model ? ` ${sku.model}` : ""}
        </span>
        <span className="text-ink-muted text-meta block">
          {instanceCount > 0
            ? `${instanceCount.toLocaleString("th-TH")} เครื่องในระบบ`
            : "ยังไม่มีเครื่องในระบบ"}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {/* แก้ไข renders for BOTH states: a reactivate can 23505 against a newer
            active SKU with the same name, and renaming the inactive row is the
            only way out — hiding the edit door there would be a dead end
            (review find, 2026-07-31). */}
        <button type="button" onClick={() => setEditing(true)} className={BUTTON_SECONDARY_COMPACT}>
          แก้ไข
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleActive()}
          className={BUTTON_SECONDARY_COMPACT}
        >
          {sku.isActive ? "ปิดใช้งาน" : "เปิดใช้อีกครั้ง"}
        </button>
      </span>
      {error ? <p className="text-danger w-full text-sm">{error}</p> : null}

      <BottomSheet open={editing} title="แก้ไขรายการทะเบียน" onClose={() => setEditing(false)}>
        <div>
          <label className="text-ink-secondary block text-sm">
            ชื่อรายการ
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
              className={FIELD_STACKED}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            ยี่ห้อ
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={80}
              placeholder="ไม่บังคับ"
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            รุ่น
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              maxLength={80}
              placeholder="ไม่บังคับ"
              className={FIELD_STACKED}
            />
          </label>
          {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || name.trim() === ""}
              onClick={() => void save()}
              className={BUTTON_PRIMARY_COMPACT}
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => {
                // Reset to the row's truth — an abandoned edit must not greet
                // the next open (the EditCategoryRow convention).
                setName(sku.name);
                setCategoryId(sku.categoryId);
                setBrand(sku.brand ?? "");
                setModel(sku.model ?? "");
                setError(null);
                setEditing(false);
              }}
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

export function EquipmentCatalogManager({
  skus,
  categories,
  instanceCounts,
  initialCategoriesOpen,
}: {
  skus: CatalogSkuRowData[];
  categories: Ref[];
  // equipment_items rows per SKU (the FK count) — "is anything real behind this
  // row" is the one instance-grain fact the TYPE page needs.
  instanceCounts: Record<string, number>;
  // The หมวดเครื่องมือ hub door deep-links here with ?open=categories — landing
  // with the sheet closed would repeat the very "door shows something else"
  // complaint this unit fixes.
  initialCategoriesOpen?: boolean;
}) {
  const [addingSku, setAddingSku] = useState(false);
  const [managingCategories, setManagingCategories] = useState(initialCategoriesOpen ?? false);

  const active = skus.filter((s) => s.isActive);
  const inactive = skus.filter((s) => !s.isActive);
  const groups = groupSkusByCategory(active, categories);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setManagingCategories(true)}
          className="text-action inline-flex min-h-11 items-center text-sm font-medium hover:underline"
        >
          {EQUIPMENT_CATEGORY_MENU_LABEL}
        </button>
        <button type="button" onClick={() => setAddingSku(true)} className={BUTTON_PRIMARY}>
          เพิ่มรายการทะเบียน
        </button>
      </div>

      {active.length === 0 ? (
        <p className="text-ink-secondary text-body">
          ทะเบียนยังว่าง — เพิ่มรายการแรกด้วยปุ่มด้านบน
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.id} className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">
                {g.name} <span className="text-ink-muted">({g.skus.length})</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {g.skus.map((s) => (
                  <SkuRow
                    key={s.id}
                    sku={s as CatalogSkuRowData}
                    categories={categories}
                    instanceCount={instanceCounts[s.id] ?? 0}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {inactive.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-meta text-ink-muted font-semibold">
            ปิดใช้งานแล้ว <span>({inactive.length})</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {inactive.map((s) => (
              <SkuRow
                key={s.id}
                sku={s}
                categories={categories}
                instanceCount={instanceCounts[s.id] ?? 0}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <BottomSheet open={addingSku} title="เพิ่มรายการทะเบียน" onClose={() => setAddingSku(false)}>
        <AddSkuForm categories={categories} onDone={() => setAddingSku(false)} />
      </BottomSheet>

      <BottomSheet
        open={managingCategories}
        title={EQUIPMENT_CATEGORY_MENU_LABEL}
        onClose={() => setManagingCategories(false)}
      >
        <QuickAddCategory />
        {categories.length > 0 ? (
          <ul className="border-edge mt-4 flex flex-col border-t pt-2">
            {categories.map((c) => (
              <EditCategoryRow
                key={c.id}
                category={c}
                // ACTIVE SKUs, matching the group headings above — one page, one
                // meaning for a category's count (review find, 2026-07-31).
                itemCount={skus.filter((s) => s.categoryId === c.id && s.isActive).length}
              />
            ))}
          </ul>
        ) : null}
      </BottomSheet>
    </div>
  );
}
