"use client";

// Spec 316 U2 — the guided 2-step role picker inside the role-change sheet,
// replacing the flat 17-option <select>. Step 1: category (สำนักงาน/หน้างาน/
// บุคคลภายนอก, the current role's category marked). Step 2: roles of that
// category — built roles first, unbuilt (roleHome → /coming-soon) sink last
// with a ยังไม่มีหน้าจอ badge — plus a derived preview (home screen +
// capabilities from the spec-316 registry) before confirm. The parent owns the
// open/submit/error state; this component owns only the step/selection state.

import { useMemo, useState } from "react";
import { ChevronLeft, TriangleAlert } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { roleHome } from "@/lib/auth/role-home";
import {
  CAPABILITY_DOMAIN_LABEL,
  ROLE_CATEGORY,
  ROLE_CATEGORY_LABEL,
  ROLE_SUMMARY,
  HOME_LABEL,
  capabilitiesForRole,
  isUnbuiltRole,
  type CapabilityDomain,
  type CapabilityEntry,
  type RoleCategory,
} from "@/lib/roles/role-capabilities";
import { ROLE_GROUP_ORDER } from "@/lib/roles/group-users";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

interface RolePickerSheetProps {
  open: boolean;
  userName: string;
  currentRole: UserRole;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (role: UserRole) => void;
}

// Derived from the label Record (its key order is the display order) so a
// future 4th category can never silently miss a step-1 tile (fresh-eyes).
const CATEGORIES = Object.keys(ROLE_CATEGORY_LABEL) as readonly RoleCategory[];

export function RolePickerSheet({
  open,
  userName,
  currentRole,
  submitting,
  error,
  onClose,
  onSubmit,
}: RolePickerSheetProps) {
  const [category, setCategory] = useState<RoleCategory | null>(null);
  const [selected, setSelected] = useState<UserRole | null>(null);

  // Closing resets to step 1 so a reopen never resumes a stale selection —
  // render-time adjust on the `open` prop edge (the parent may close directly
  // after a successful submit, so an onClose wrapper alone would miss it).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setCategory(null);
      setSelected(null);
    }
  }

  // ROLE_GROUP_ORDER keeps the house ordering; unbuilt roles sink last.
  const roles = useMemo(() => {
    if (!category) return [];
    const inCategory = ROLE_GROUP_ORDER.filter((r) => ROLE_CATEGORY[r] === category);
    return [...inCategory.filter((r) => !isUnbuiltRole(r)), ...inCategory.filter(isUnbuiltRole)];
  }, [category]);

  const canSubmit = selected !== null && selected !== currentRole && !submitting;

  return (
    <BottomSheet open={open} title={`เปลี่ยนสิทธิ์ — ${userName}`} onClose={onClose}>
      {/* Parent-owned submit error — visible on either step (state survives a
          failed submit, but never hide the message behind step navigation). */}
      {error && (
        <div role="alert" className={`${INLINE_ERROR} mb-3`}>
          {error}
        </div>
      )}
      {category === null ? (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-sm font-medium">เลือกกลุ่มของสิทธิ์ใหม่</p>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className="border-edge bg-card rounded-control focus-visible:ring-action flex min-h-11 items-center justify-between gap-2 border px-4 py-3 text-left focus:outline-none focus-visible:ring-2"
            >
              <span className="text-ink text-body font-medium">{ROLE_CATEGORY_LABEL[cat]}</span>
              {ROLE_CATEGORY[currentRole] === cat && (
                <span className="text-ink-muted text-meta shrink-0">สิทธิ์ปัจจุบัน</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setCategory(null);
              setSelected(null);
            }}
            className="text-action focus-visible:ring-action -mx-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-1 text-sm font-medium focus:outline-none focus-visible:ring-2"
          >
            <ChevronLeft aria-hidden className="size-4" />
            กลับ
          </button>

          <div role="radiogroup" aria-label="สิทธิ์ใหม่" className="flex flex-col gap-2">
            {roles.map((role) => {
              const unbuilt = isUnbuiltRole(role);
              const active = selected === role;
              return (
                <button
                  key={role}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(role)}
                  className={`rounded-control focus-visible:ring-action flex min-h-11 flex-col gap-0.5 border px-4 py-2.5 text-left focus:outline-none focus-visible:ring-2 ${
                    active ? "border-action bg-action/5" : "border-edge bg-card"
                  }`}
                >
                  <span className="text-ink text-body flex items-center gap-2 font-medium">
                    {USER_ROLE_LABEL[role]}
                    {unbuilt && (
                      <span className="text-attn-ink text-meta inline-flex items-center gap-1">
                        <TriangleAlert aria-hidden className="size-3.5" />
                        ยังไม่มีหน้าจอ
                      </span>
                    )}
                  </span>
                  <span className="text-ink-secondary text-meta">{ROLE_SUMMARY[role]}</span>
                </button>
              );
            })}
          </div>

          {selected && <RolePreview role={selected} />}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => selected && onSubmit(selected)}
              disabled={!canSubmit}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

// The derived what-they-get card: home screen via roleHome() + the visible
// capability entries, grouped under their domain headers (registry order).
function RolePreview({ role }: { role: UserRole }) {
  const caps = capabilitiesForRole(role);
  const grouped: [CapabilityDomain, CapabilityEntry[]][] = [];
  for (const entry of caps) {
    const bucket = grouped.find(([d]) => d === entry.domain);
    if (bucket) bucket[1].push(entry);
    else grouped.push([entry.domain, [entry]]);
  }
  return (
    <div className="border-edge bg-sunk rounded-control flex flex-col gap-2 border px-4 py-3">
      <p className="text-ink text-sm">
        หน้าแรก:{" "}
        <span className="font-semibold">{HOME_LABEL[roleHome(role)] ?? roleHome(role)}</span>
      </p>
      {grouped.length === 0 ? (
        <p className="text-ink-secondary text-meta">ยังไม่มีรายการสิทธิ์เฉพาะ</p>
      ) : (
        grouped.map(([domain, entries]) => (
          <div key={domain} className="flex flex-col gap-0.5">
            <p className="text-ink-secondary text-meta font-semibold">
              {CAPABILITY_DOMAIN_LABEL[domain]}
            </p>
            <ul className="text-ink-secondary text-meta list-disc pl-5">
              {entries.map((e) => (
                <li key={e.key}>{e.labelTh}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
