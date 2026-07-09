"use client";

// Spec 284 U5 / ADR 0080 — the contract create form (/legal/contracts). 'use
// client': controlled fields + useTransition + navigate to the new contract on
// success. Required: counterparty name + title (the RPC is the real guard; the UI
// gates too). Optional project / amount are omitted when untouched (never passed
// as undefined — exactOptionalPropertyTypes). Relays U3's createContract
// (SECURITY DEFINER, LEGAL_ROLES); the new contract starts as a draft.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContractCounterpartyType, ContractType } from "@/lib/db/enums";
import { createContract, type CreateContractInput } from "@/lib/legal/contracts";
import { CONTRACT_COUNTERPARTY_LABEL, CONTRACT_TYPE_LABEL } from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, FIELD_INPUT, FIELD_SELECT, INLINE_ERROR } from "@/lib/ui/classes";

export interface ProjectOption {
  id: string;
  label: string;
}

const COUNTERPARTY_TYPES = Object.keys(
  CONTRACT_COUNTERPARTY_LABEL,
) as ReadonlyArray<ContractCounterpartyType>;
const CONTRACT_TYPES = Object.keys(CONTRACT_TYPE_LABEL) as ReadonlyArray<ContractType>;

const LABEL = "text-ink-secondary flex flex-col gap-1 text-xs";

export function ContractCreateForm({ projects }: { projects: ReadonlyArray<ProjectOption> }) {
  const router = useRouter();
  const [counterpartyType, setCounterpartyType] = useState<ContractCounterpartyType>("client");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [contractType, setContractType] = useState<ContractType>("client_agreement");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit = counterpartyName.trim().length > 0 && title.trim().length > 0 && !pending;

  function submit() {
    setError(null);
    const input: CreateContractInput = {
      counterpartyType,
      counterpartyName: counterpartyName.trim(),
      contractType,
      title: title.trim(),
    };
    if (projectId) input.projectId = projectId;
    const n = Number(amount);
    if (amount.trim() && Number.isFinite(n)) input.agreedAmount = n;

    startTransition(async () => {
      const r = await createContract(input);
      if (r.ok) router.push(`/legal/contracts/${r.id}`);
      else setError(r.error);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
      className="border-edge bg-card rounded-card shadow-card flex flex-col gap-3 border p-4"
    >
      <label className={LABEL}>
        ประเภทคู่สัญญา
        <select
          value={counterpartyType}
          onChange={(e) => setCounterpartyType(e.target.value as ContractCounterpartyType)}
          className={FIELD_SELECT}
        >
          {COUNTERPARTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {CONTRACT_COUNTERPARTY_LABEL[t]}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        ชื่อคู่สัญญา
        <input
          value={counterpartyName}
          onChange={(e) => setCounterpartyName(e.target.value)}
          className={FIELD_INPUT}
          placeholder="เช่น บริษัท เอซีเอ็มอี จำกัด"
        />
      </label>

      <label className={LABEL}>
        ประเภทสัญญา
        <select
          value={contractType}
          onChange={(e) => setContractType(e.target.value as ContractType)}
          className={FIELD_SELECT}
        >
          {CONTRACT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CONTRACT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        ชื่อสัญญา
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={FIELD_INPUT}
          placeholder="เช่น สัญญาจ้างเหมาก่อสร้าง"
        />
      </label>

      <label className={LABEL}>
        โครงการ (ถ้ามี)
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className={FIELD_SELECT}
        >
          <option value="">— ไม่ระบุ —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        มูลค่า (บาท, ถ้ามี)
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={FIELD_INPUT}
          placeholder="0.00"
        />
      </label>

      {error ? (
        <p role="alert" className={INLINE_ERROR}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
        สร้างสัญญา
      </button>
    </form>
  );
}
