"use client";

// Spec 220 / ADR 0050 (G63) — the per-user role control on the super_admin role
// admin screen. Each row shows the user + current role; "เปลี่ยนสิทธิ์" opens a
// sheet with a role picker → setUserRole. The current user's own row has no
// control (mirrors the RPC's self-demotion guard). Client component: it owns the
// sheet/optimistic-pending state and calls the server action.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { setUserRole } from "@/app/settings/roles/actions";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

export type RoleUserVM = { id: string; name: string; role: UserRole; isSelf: boolean };

const ROLE_OPTIONS = Object.entries(USER_ROLE_LABEL) as [UserRole, string][];

const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function RoleAdminList({ users }: { users: RoleUserVM[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {users.map((u) => (
        <li key={u.id}>
          <RoleRow user={u} />
        </li>
      ))}
    </ul>
  );
}

function RoleRow({ user }: { user: RoleUserVM }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>(user.role);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function close() {
    setRole(user.role);
    setError(null);
    setOpen(false);
  }

  const canSubmit = role !== user.role && !submitting;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await setUserRole(user.id, role);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="border-edge bg-card rounded-control flex items-center justify-between gap-3 border px-4 py-3">
      {/* Spec 265 U2: the name/role drills into the per-user detail
          (/settings/roles/[id]) where the super_admin sees the LINE ground-truth
          identity beside the app name. The role-change control stays inline. */}
      <Link
        href={`/settings/roles/${user.id}`}
        className="focus-visible:ring-action -mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 focus:outline-none focus-visible:ring-2"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-ink text-body truncate font-semibold">{user.name}</span>
          <span className="text-ink-secondary text-meta">{USER_ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronRight aria-hidden className="text-ink-muted size-4 shrink-0" />
      </Link>

      {user.isSelf ? (
        <span className="text-ink-muted text-meta shrink-0">คุณ</span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-action focus-visible:ring-action inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2"
        >
          <ShieldCheck aria-hidden className="size-4" />
          เปลี่ยนสิทธิ์
        </button>
      )}

      <BottomSheet open={open} title={`เปลี่ยนสิทธิ์ — ${user.name}`} onClose={close}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`role-${user.id}`} className="text-ink text-sm font-medium">
              สิทธิ์ใหม่
            </label>
            <select
              id={`role-${user.id}`}
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={submitting}
              className={FIELD}
            >
              {ROLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="button" onClick={submit} disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
