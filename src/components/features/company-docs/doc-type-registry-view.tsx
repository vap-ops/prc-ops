"use client";
// Spec 331 §5 — the super_admin registry editor. Read-first: every category with
// its types and their four flags, so the operator can see the standard at a
// glance. Editing is per-row (a sheet), and nothing is ever deleted — a type
// leaves the picker by being deactivated, and its existing documents keep
// rendering.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  createDocumentType,
  setDocumentTypeActive,
  updateDocumentType,
} from "@/lib/company-docs/registry-actions";
import type { DocCategoryRow, DocTypeRow } from "@/lib/company-docs/registry";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  COMPANY_DOC_REQUIRED_BADGE,
  COMPANY_DOC_TYPE_LABEL,
  COMPANY_DOC_TYPES_LABEL,
} from "@/lib/i18n/labels";

const FIELD = "border-edge bg-card text-ink rounded-control border px-3 py-2 text-base";
const CHIP = "text-meta rounded-full px-2 py-0.5 font-medium";

interface EditTarget {
  categoryCode: string;
  type: DocTypeRow | null; // null = create a new type in this category
}

export function DocTypeRegistryView({
  categories,
  types,
}: {
  categories: DocCategoryRow[];
  types: DocTypeRow[];
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive(type: DocTypeRow) {
    setError(null);
    const r = await setDocumentTypeActive({ code: type.code, isActive: !type.is_active });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  async function submit(form: FormData) {
    if (edit === null) return;
    const fields = {
      nameTh: String(form.get("name_th") ?? "").trim(),
      hint: String(form.get("hint") ?? "").trim() || null,
      isSingleton: form.get("is_singleton") === "on",
      isRequired: form.get("is_required") === "on",
      requiresExpiry: form.get("requires_expiry") === "on",
      sortOrder: Number(form.get("sort_order") ?? 0),
    };
    setBusy(true);
    setError(null);
    const r =
      edit.type === null
        ? await createDocumentType({
            ...fields,
            categoryCode: edit.categoryCode,
            code: String(form.get("code") ?? "")
              .trim()
              .toUpperCase(),
          })
        : await updateDocumentType({ ...fields, code: edit.type.code });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEdit(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="text-danger text-sm">{error}</p> : null}

      {categories.map((c) => {
        const own = types.filter((t) => t.category_id === c.id);
        return (
          <section key={c.id} className="flex flex-col gap-2" aria-label={c.name_th}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-ink text-base font-semibold">
                {c.name_th}
                {!c.is_active ? (
                  <span className="text-ink-muted text-meta ml-2">(ปิดใช้งาน)</span>
                ) : null}
              </h2>
              <button
                type="button"
                onClick={() => setEdit({ categoryCode: c.code, type: null })}
                className="border-edge bg-card hover:bg-sunk text-ink rounded-control flex items-center gap-1 border px-3 py-1.5 text-sm"
              >
                <Plus aria-hidden className="h-4 w-4" />
                เพิ่มประเภท
              </button>
            </div>

            <ul className="flex flex-col gap-1">
              {own.map((t) => (
                <li
                  key={t.id}
                  className="border-edge bg-card rounded-control flex items-start gap-3 border p-3"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        t.is_active
                          ? "text-ink text-body block font-semibold"
                          : "text-ink-muted text-body block font-semibold line-through"
                      }
                    >
                      {t.name_th}
                    </span>
                    <span className="text-ink-muted text-meta block">{t.code}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {t.is_required ? (
                        <span className={`bg-attn-soft text-attn-ink ${CHIP}`}>
                          {COMPANY_DOC_REQUIRED_BADGE}
                        </span>
                      ) : null}
                      <span className={`bg-sunk text-ink-secondary ${CHIP}`}>
                        {t.is_singleton ? "ฉบับเดียว" : "หลายฉบับ"}
                      </span>
                      {t.requires_expiry ? (
                        <span className={`bg-sunk text-ink-secondary ${CHIP}`}>
                          ต้องมีวันหมดอายุ
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => setEdit({ categoryCode: c.code, type: t })}
                      className="border-edge bg-card hover:bg-sunk text-ink rounded-control border px-3 py-1 text-sm"
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleActive(t)}
                      className="text-ink-muted text-meta underline"
                    >
                      {t.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    </button>
                  </span>
                </li>
              ))}
              {own.length === 0 ? (
                <li className="text-ink-muted text-meta px-1">ยังไม่มีประเภทในหมวดนี้</li>
              ) : null}
            </ul>
          </section>
        );
      })}

      <BottomSheet
        open={edit !== null}
        title={edit?.type === null ? "เพิ่มประเภทเอกสาร" : COMPANY_DOC_TYPES_LABEL}
        onClose={() => setEdit(null)}
      >
        {edit !== null ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(new FormData(e.currentTarget));
            }}
          >
            {edit.type === null ? (
              <label className="flex flex-col gap-1">
                <span className="text-ink-secondary text-sm">รหัส (เช่น TAX_PP20)</span>
                <input
                  type="text"
                  name="code"
                  required
                  maxLength={40}
                  pattern="[A-Za-z0-9_]+"
                  className={FIELD}
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-ink-secondary text-sm">{COMPANY_DOC_TYPE_LABEL}</span>
              <input
                type="text"
                name="name_th"
                required
                maxLength={200}
                defaultValue={edit.type?.name_th ?? ""}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-secondary text-sm">คำอธิบาย (ไม่บังคับ)</span>
              <input
                type="text"
                name="hint"
                maxLength={300}
                defaultValue={edit.type?.hint ?? ""}
                className={FIELD}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="is_singleton"
                defaultChecked={edit.type?.is_singleton ?? true}
              />
              <span className="text-ink text-sm">มีได้ฉบับเดียว (ห้ามซ้ำ)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="is_required"
                defaultChecked={edit.type?.is_required ?? false}
              />
              <span className="text-ink text-sm">บริษัทต้องมี (ขึ้นในรายการยังขาด)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requires_expiry"
                defaultChecked={edit.type?.requires_expiry ?? false}
              />
              <span className="text-ink text-sm">ต้องระบุวันหมดอายุ</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-secondary text-sm">ลำดับการแสดง</span>
              <input
                type="number"
                name="sort_order"
                defaultValue={edit.type?.sort_order ?? 0}
                className={FIELD}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="bg-action text-on-fill rounded-control px-4 py-2.5 text-base font-semibold disabled:opacity-60"
            >
              {busy ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </form>
        ) : null}
      </BottomSheet>
    </div>
  );
}
