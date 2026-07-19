"use client";
// Spec 331 §6 — the upload sheet's type picker. ONE grouped select (categories as
// optgroups) replaces spec 329's free-text title: accounting picks from the
// registry, never invents a name — that is the whole anti-redundancy mechanism.
//
// The chosen type's flags drive the rest of the form: MULTI types need a label to
// tell instances apart ("กรุงไทย – โครงการ A"), requires_expiry types make the
// expiry date mandatory. Both are re-enforced in the DB by the spec-331 trigger;
// these are the courteous front half.
import type { DocTypeGroup, DocTypeRow } from "@/lib/company-docs/registry";
import {
  COMPANY_DOC_INSTANCE_LABEL,
  COMPANY_DOC_TYPE_LABEL,
  COMPANY_DOC_TYPE_PLACEHOLDER,
} from "@/lib/i18n/labels";

const FIELD = "border-edge bg-card text-ink rounded-control border px-3 py-2 text-base";

export function DocTypePicker({
  groups,
  selected,
  onSelect,
  locked = false,
}: {
  groups: DocTypeGroup[];
  selected: DocTypeRow | null;
  onSelect: (type: DocTypeRow | null) => void;
  /** A version keeps its chain type; the ยังขาด list preselects one. */
  locked?: boolean;
}) {
  const byId = new Map(groups.flatMap((g) => g.types).map((t) => [t.id, t]));

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-ink-secondary text-sm">{COMPANY_DOC_TYPE_LABEL}</span>
        <select
          name="type_id"
          required
          disabled={locked}
          value={selected?.id ?? ""}
          onChange={(e) => onSelect(byId.get(e.target.value) ?? null)}
          className={FIELD}
        >
          <option value="">{COMPANY_DOC_TYPE_PLACEHOLDER}</option>
          {groups.map((g) => (
            <optgroup key={g.category.id} label={g.category.name_th}>
              {g.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_th}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {selected?.hint ? <span className="text-ink-muted text-meta">{selected.hint}</span> : null}
      </label>

      {selected && !selected.is_singleton ? (
        <label className="flex flex-col gap-1">
          <span className="text-ink-secondary text-sm">{COMPANY_DOC_INSTANCE_LABEL}</span>
          <input type="text" name="label" maxLength={200} required className={FIELD} />
        </label>
      ) : null}
    </>
  );
}
