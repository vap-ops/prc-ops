"use client";

// Spec 81 — generic record manager. Drives the contacts screens (clients /
// suppliers / contractors) at /pm/contacts from a field schema. Presentational:
// the entity's create/update server actions are injected as onCreate / onUpdate, so
// no server function is imported here and the 42501→Thai mapping stays in each
// action (the NotesField pattern, spec 72).
//
// 'use client' justification: add + per-row edit forms with busy states.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { BottomSheet } from "@/components/features/bottom-sheet";

export type RecordActionResult = { ok: true } | { ok: false; error: string };

/** A small status chip rendered next to a row's name (spec 87). neutral = a
 *  plain info chip (spec 107 supplier spend), not a warning. */
export type RecordBadge = { label: string; tone: "amber" | "red" | "neutral" };

export interface RecordFieldDef {
  /** Record key passed to onCreate/onUpdate (camelCase, maps to the action input). */
  key: string;
  label: string;
  type: "text" | "tel" | "email" | "textarea" | "select";
  /** Required for text/tel/email/textarea; ignored for select. */
  maxLength?: number;
  /** Required for type "select": the dropdown options (spec 86). */
  options?: { value: string; label: string }[];
}

export interface RecordRow {
  id: string;
  values: Record<string, string | null>;
}

interface RecordManagerProps {
  addLabel: string;
  fields: RecordFieldDef[];
  rows: RecordRow[];
  onCreate: (values: Record<string, string>) => Promise<RecordActionResult>;
  onUpdate: (id: string, values: Record<string, string>) => Promise<RecordActionResult>;
  /** Spec 87: list-first — the add form opens in a BottomSheet behind an Add button. */
  addInSheet?: boolean;
  /** Spec 87: optional status chip per row (e.g. ทดลองงาน / บัญชีดำ). */
  rowBadge?: (row: RecordRow) => RecordBadge | null;
  /** Spec 88: when set, a row's name links to its detail page. */
  rowHref?: (row: RecordRow) => string;
}

function FieldInputs({
  fields,
  values,
  setValue,
  disabled,
}: {
  fields: RecordFieldDef[];
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.key} className="text-ink-secondary mt-2 block text-sm">
          {f.label}
          {f.type === "textarea" ? (
            <textarea
              value={values[f.key] ?? ""}
              maxLength={f.maxLength}
              rows={2}
              disabled={disabled}
              onChange={(e) => setValue(f.key, e.target.value)}
              className={FIELD_STACKED}
            />
          ) : f.type === "select" ? (
            <select
              value={values[f.key] ?? ""}
              disabled={disabled}
              onChange={(e) => setValue(f.key, e.target.value)}
              className={`${FIELD_STACKED} appearance-none`}
            >
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type}
              inputMode={f.type === "tel" ? "tel" : undefined}
              value={values[f.key] ?? ""}
              maxLength={f.maxLength}
              disabled={disabled}
              onChange={(e) => setValue(f.key, e.target.value)}
              className={FIELD_STACKED}
            />
          )}
        </label>
      ))}
    </>
  );
}

function blankValues(fields: RecordFieldDef[]): Record<string, string> {
  // A select defaults to its first option (a valid enum value), not "".
  return Object.fromEntries(
    fields.map((f) => [f.key, f.type === "select" ? (f.options?.[0]?.value ?? "") : ""]),
  );
}

function AddCard({
  addLabel,
  fields,
  onCreate,
  onDone,
  bare,
}: {
  addLabel: string;
  fields: RecordFieldDef[];
  onCreate: RecordManagerProps["onCreate"];
  /** Called after a successful create (e.g. to close the sheet). */
  onDone?: () => void;
  /** Drop the CARD wrapper + heading (the sheet already provides them). */
  bare?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => blankValues(fields));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The first field is the entity name — the one required value.
  const nameKey = fields[0]?.key ?? "name";
  const nameEmpty = (values[nameKey] ?? "").trim().length === 0;

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await onCreate(values);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setValues(blankValues(fields));
    toast.success("บันทึกแล้ว");
    router.refresh();
    onDone?.();
  }

  const body = (
    <>
      {bare ? null : <p className="text-ink text-sm font-semibold">{addLabel}</p>}
      <FieldInputs
        fields={fields}
        values={values}
        setValue={(key, value) => {
          setValues((prev) => ({ ...prev, [key]: value }));
          setError(null);
        }}
        disabled={busy}
      />
      {error ? (
        <p role="alert" className={`mt-2 ${INLINE_ALERT_TEXT}`}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy || nameEmpty}
        onClick={() => void submit()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
      >
        {addLabel}
      </button>
    </>
  );

  return bare ? body : <div className={CARD}>{body}</div>;
}

function RecordRowItem({
  fields,
  row,
  onUpdate,
  badge,
  href,
}: {
  fields: RecordFieldDef[];
  row: RecordRow;
  onUpdate: RecordManagerProps["onUpdate"];
  badge?: RecordBadge | null;
  href?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, row.values[f.key] ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameKey = fields[0]?.key ?? "name";
  const name = row.values[nameKey] ?? "";
  // First non-name field that has a value — a one-line preview under the name.
  const previewField = fields.slice(1).find((f) => (row.values[f.key] ?? "").trim().length > 0);

  async function save() {
    setBusy(true);
    setError(null);
    // Only changed fields are sent (omitted = preserved; "" = cleared).
    const changed: Record<string, string> = {};
    for (const f of fields) {
      const orig = row.values[f.key] ?? "";
      const next = values[f.key] ?? "";
      if (next !== orig) changed[f.key] = next;
    }
    if (Object.keys(changed).length === 0) {
      setBusy(false);
      setEditing(false);
      return;
    }
    const result = await onUpdate(row.id, changed);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    toast.success("บันทึกแล้ว");
    router.refresh();
  }

  return (
    <li className="border-edge active:bg-sunk border-t py-2 transition-colors first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink flex items-center gap-2 text-sm">
            {href ? (
              <Link href={href} className="text-action truncate font-medium hover:underline">
                {name}
              </Link>
            ) : (
              <span className="truncate">{name}</span>
            )}
            {badge ? (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  badge.tone === "red"
                    ? "bg-danger-soft text-danger-ink"
                    : badge.tone === "neutral"
                      ? "bg-sunk text-ink-secondary"
                      : "bg-attn-soft text-attn-ink"
                }`}
              >
                {badge.label}
              </span>
            ) : null}
          </p>
          {previewField ? (
            <p className="text-ink-secondary truncate text-xs">{row.values[previewField.key]}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="text-action shrink-0 text-xs font-medium hover:underline"
        >
          แก้ไข
        </button>
      </div>
      {editing ? (
        <div className="border-edge-strong bg-page mt-2 rounded-lg border p-3">
          <FieldInputs
            fields={fields}
            values={values}
            setValue={(key, value) => {
              setValues((prev) => ({ ...prev, [key]: value }));
              setError(null);
            }}
            disabled={busy}
          />
          {error ? (
            <p role="alert" className={`mt-2 ${INLINE_ALERT_TEXT}`}>
              {error}
            </p>
          ) : null}
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

export function RecordManager({
  addLabel,
  fields,
  rows,
  onCreate,
  onUpdate,
  addInSheet,
  rowBadge,
  rowHref,
}: RecordManagerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {addInSheet ? (
        <>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={`w-full ${BUTTON_PRIMARY_COMPACT}`}
          >
            {addLabel}
          </button>
          <BottomSheet open={sheetOpen} title={addLabel} onClose={() => setSheetOpen(false)}>
            <AddCard
              addLabel={addLabel}
              fields={fields}
              onCreate={onCreate}
              onDone={() => setSheetOpen(false)}
              bare
            />
          </BottomSheet>
        </>
      ) : (
        <AddCard addLabel={addLabel} fields={fields} onCreate={onCreate} />
      )}
      {rows.length > 0 ? (
        <div className={CARD}>
          <p className="text-ink text-sm font-semibold">รายการ ({rows.length})</p>
          <ul className="mt-2 flex flex-col">
            {rows.map((r) => (
              <RecordRowItem
                key={r.id}
                fields={fields}
                row={r}
                onUpdate={onUpdate}
                badge={rowBadge ? rowBadge(r) : null}
                {...(rowHref ? { href: rowHref(r) } : {})}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
