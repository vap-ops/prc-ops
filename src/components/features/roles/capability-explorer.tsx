"use client";

// Spec 316 U3 — the /settings/roles/capabilities client island. Two lenses over
// the spec-316 capability registry: ตามบทบาท (per-role accordion under the
// three category headers) and ตามสิทธิ์ (per-capability under domain headers,
// expanding to the roles that hold it). A single search box filters whichever
// lens is active; non-matching accordions unmount. Everything rendered here is
// static registry data derived from the live role sets — no DB read, so the
// page can never disagree with the real gates.

import { useState } from "react";
import { TriangleAlert } from "lucide-react";

import { EmptyNotice } from "@/components/features/common/notices";
import { roleHome } from "@/lib/auth/role-home";
import {
  CAPABILITY_DOMAIN_LABEL,
  CAPABILITY_REGISTRY,
  HOME_LABEL,
  ROLE_CATEGORY,
  ROLE_CATEGORY_LABEL,
  ROLE_SUMMARY,
  capabilitiesForRole,
  isUnbuiltRole,
  type CapabilityDomain,
  type CapabilityEntry,
  type RoleCategory,
} from "@/lib/roles/role-capabilities";
import { ROLE_GROUP_ORDER } from "@/lib/roles/group-users";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

type Lens = "roles" | "capabilities";

const CATEGORIES = Object.keys(ROLE_CATEGORY_LABEL) as readonly RoleCategory[];
const DOMAINS = Object.keys(CAPABILITY_DOMAIN_LABEL) as readonly CapabilityDomain[];

const LENS_TAB =
  "focus-visible:ring-action min-h-11 flex-1 rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2";

export function CapabilityExplorer() {
  const [lens, setLens] = useState<Lens>("roles");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="เลือกมุมมอง"
        className="border-edge bg-sunk flex gap-1 rounded-lg border p-1"
      >
        <button
          type="button"
          aria-pressed={lens === "roles"}
          onClick={() => setLens("roles")}
          className={`${LENS_TAB} ${lens === "roles" ? "bg-card text-ink shadow-sm" : "text-ink-secondary"}`}
        >
          ตามบทบาท
        </button>
        <button
          type="button"
          aria-pressed={lens === "capabilities"}
          onClick={() => setLens("capabilities")}
          className={`${LENS_TAB} ${lens === "capabilities" ? "bg-card text-ink shadow-sm" : "text-ink-secondary"}`}
        >
          ตามสิทธิ์
        </button>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ค้นหา…"
        aria-label="ค้นหาบทบาทหรือสิทธิ์"
        className="rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action min-h-11 w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
      />

      {lens === "roles" ? <ByRoleLens q={q} /> : <ByCapabilityLens q={q} />}
    </div>
  );
}

function ByRoleLens({ q }: { q: string }) {
  const sections = CATEGORIES.map((cat) => {
    const roles = ROLE_GROUP_ORDER.filter((r) => ROLE_CATEGORY[r] === cat).filter(
      (r) =>
        !q ||
        USER_ROLE_LABEL[r].toLowerCase().includes(q) ||
        ROLE_SUMMARY[r].toLowerCase().includes(q),
    );
    return { cat, roles };
  }).filter((s) => s.roles.length > 0);

  if (sections.length === 0) return <EmptyNotice>ไม่พบรายการ</EmptyNotice>;

  return (
    <div className="flex flex-col gap-4">
      {sections.map(({ cat, roles }) => (
        <section key={cat} aria-label={ROLE_CATEGORY_LABEL[cat]}>
          <h2 className="text-ink-secondary mb-2 text-sm font-semibold">
            {ROLE_CATEGORY_LABEL[cat]}
          </h2>
          <div className="flex flex-col gap-2">
            {roles.map((role) => (
              <RoleCard key={role} role={role} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RoleCard({ role }: { role: UserRole }) {
  const caps = capabilitiesForRole(role);
  const grouped: [CapabilityDomain, CapabilityEntry[]][] = [];
  for (const entry of caps) {
    const bucket = grouped.find(([d]) => d === entry.domain);
    if (bucket) bucket[1].push(entry);
    else grouped.push([entry.domain, [entry]]);
  }
  return (
    <details className="border-edge bg-card rounded-control border">
      <summary className="text-ink flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {USER_ROLE_LABEL[role]}
        {isUnbuiltRole(role) && (
          <span className="text-attn-ink text-meta inline-flex items-center gap-1">
            <TriangleAlert aria-hidden className="size-3.5" />
            ยังไม่มีหน้าจอ
          </span>
        )}
      </summary>
      <div className="border-edge flex flex-col gap-2 border-t px-4 py-3">
        <p className="text-ink-secondary text-meta">{ROLE_SUMMARY[role]}</p>
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
    </details>
  );
}

function ByCapabilityLens({ q }: { q: string }) {
  const sections = DOMAINS.map((domain) => {
    const entries = CAPABILITY_REGISTRY.filter(
      (e) => !e.hidden && e.domain === domain && (!q || e.labelTh.toLowerCase().includes(q)),
    );
    return { domain, entries };
  }).filter((s) => s.entries.length > 0);

  if (sections.length === 0) return <EmptyNotice>ไม่พบรายการ</EmptyNotice>;

  return (
    <div className="flex flex-col gap-4">
      {sections.map(({ domain, entries }) => (
        <section key={domain} aria-label={CAPABILITY_DOMAIN_LABEL[domain]}>
          <h2 className="text-ink-secondary mb-2 text-sm font-semibold">
            {CAPABILITY_DOMAIN_LABEL[domain]}
          </h2>
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <details key={entry.key} className="border-edge bg-card rounded-control border">
                <summary className="text-ink flex min-h-11 cursor-pointer list-none items-center px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  {entry.labelTh}
                </summary>
                <div className="border-edge border-t px-4 py-3">
                  {/* Members grouped by category so the reader sees at a glance
                      which side of the org holds the capability. */}
                  {CATEGORIES.map((cat) => {
                    const members = entry.roles.filter((r) => ROLE_CATEGORY[r] === cat);
                    if (members.length === 0) return null;
                    return (
                      <div key={cat} className="mb-2 flex flex-col gap-1 last:mb-0">
                        <p className="text-ink-muted text-meta">{ROLE_CATEGORY_LABEL[cat]}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {members.map((r) => (
                            <span
                              key={r}
                              className="border-edge bg-sunk text-ink-secondary text-meta rounded-full border px-2.5 py-1"
                            >
                              {USER_ROLE_LABEL[r]}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
