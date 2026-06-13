"use client";

// Spec 81 — generic record manager. Drives the contacts screens (clients /
// suppliers / contractors) at /pm/contacts from a field schema. Presentational:
// the entity's create/update server actions are injected as onCreate / onUpdate, so
// no server function is imported here and the 42501→Thai mapping stays in each
// action (the NotesField pattern, spec 72).
//
// 'use client' justification: add + per-row edit forms with busy states.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_STACKED,
  INLINE_ALERT_TEXT,
} from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";

export type RecordActionResult = { ok: true } | { ok: false; error: string };

export interface RecordFieldDef {
  /** Record key passed to onCreate/onUpdate (camelCase, maps to the action input). */
  key: string;
  label: string;
  type: "text" | "tel" | "email" | "textarea";
  maxLength: number;
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
        <label key={f.key} className="mt-2 block text-sm text-zinc-700">
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
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}

function AddCard({
  addLabel,
  fields,
  onCreate,
}: {
  addLabel: string;
  fields: RecordFieldDef[];
  onCreate: RecordManagerProps["onCreate"];
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
  }

  return (
    <div className={CARD}>
      <p className="text-sm font-semibold text-zinc-900">{addLabel}</p>
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
    </div>
  );
}

function RecordRowItem({
  fields,
  row,
  onUpdate,
}: {
  fields: RecordFieldDef[];
  row: RecordRow;
  onUpdate: RecordManagerProps["onUpdate"];
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
    <li className="border-t border-zinc-200 py-2 transition-colors first:border-t-0 active:bg-zinc-100">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-900">{name}</p>
          {previewField ? (
            <p className="truncate text-xs text-zinc-600">{row.values[previewField.key]}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
        >
          แก้ไข
        </button>
      </div>
      {editing ? (
        <div className="mt-2 rounded-lg border border-zinc-300 bg-zinc-50 p-3">
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

export function RecordManager({ addLabel, fields, rows, onCreate, onUpdate }: RecordManagerProps) {
  return (
    <div className="flex flex-col gap-4">
      <AddCard addLabel={addLabel} fields={fields} onCreate={onCreate} />
      {rows.length > 0 ? (
        <div className={CARD}>
          <p className="text-sm font-semibold text-zinc-900">รายการ ({rows.length})</p>
          <ul className="mt-2 flex flex-col">
            {rows.map((r) => (
              <RecordRowItem key={r.id} fields={fields} row={r} onUpdate={onUpdate} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
