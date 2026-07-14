"use client";

// Spec 316 U2 — the /settings/roles list body: client-side name search over
// the already-loaded user list, grouped sections via the groupUsersByRole SSOT
// (visitor promotion queue leads, per feedback d00c3d0e), EmptyNotice when the
// query matches nobody. The page stays a Server Component and hands the flat
// RoleUserVM[] here.

import { useState } from "react";

import { EmptyNotice } from "@/components/features/common/notices";
import { RoleAdminList, type RoleUserVM } from "@/components/features/roles/role-admin-list";
import { groupUsersByRole } from "@/lib/roles/group-users";

/** Pure so the matching rule is unit-testable: trimmed, case-insensitive substring. */
export function filterUsersByName(users: readonly RoleUserVM[], query: string): RoleUserVM[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...users];
  return users.filter((u) => u.name.toLowerCase().includes(q));
}

export function RoleDirectory({ users }: { users: RoleUserVM[] }) {
  const [query, setQuery] = useState("");
  const filtered = filterUsersByName(users, query);
  const groups = groupUsersByRole(filtered);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ค้นหาชื่อ…"
        aria-label="ค้นหาชื่อผู้ใช้"
        className="rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action min-h-11 w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
      />

      {filtered.length === 0 ? (
        <EmptyNotice>ไม่พบผู้ใช้</EmptyNotice>
      ) : (
        groups.map((g) => (
          <section key={g.role} aria-label={g.label}>
            <h2 className="text-ink-secondary mb-2 flex items-baseline gap-1.5 text-sm font-semibold">
              {g.role === "visitor" ? "รอกำหนดสิทธิ์" : g.label}
              <span className="text-ink-muted text-xs font-normal">{g.users.length} คน</span>
            </h2>
            <RoleAdminList users={g.users} />
          </section>
        ))
      )}
    </div>
  );
}
