"use client";

// 'use client' justification (feature spec 09, ADR 0022):
//
// This form owns input state, inline validation, a useTransition pending
// state, and a "Saved" confirmation that must appear only AFTER an actual
// successful round-trip in this session. A Server Component cannot hold
// those — the post-save signal is a transient client-only flag, not
// derived from server-rendered props. Mirrors DisplayNameForm.
//
// The work-package picker is populated from the parent Server Component
// (the caller's RLS on work_packages already gates the list). The pure
// validator from src/lib/purchasing/validate-purchase-request.ts is the
// single source of truth for shape — the action layer runs the same one.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseRequest } from "@/app/requests/actions";
import { validateCreatePurchaseRequest } from "@/lib/purchasing/validate-purchase-request";

export interface PurchaseRequestFormWorkPackage {
  id: string;
  code: string;
  name: string;
}

interface PurchaseRequestFormProps {
  workPackages: ReadonlyArray<PurchaseRequestFormWorkPackage>;
}

export function PurchaseRequestForm({ workPackages }: PurchaseRequestFormProps) {
  const router = useRouter();
  const [workPackageId, setWorkPackageId] = useState<string>("");
  const [itemDescription, setItemDescription] = useState<string>("");
  const [quantityText, setQuantityText] = useState<string>("");
  const [unit, setUnit] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitting, startSubmit] = useTransition();

  // Quantity is a numeric column at the DB and the validator wants a
  // finite positive number. The input is a free-text field so users can
  // type "12.5", "0.5", etc.; parseFloat returns NaN for empties /
  // garbage, which the validator then rejects cleanly.
  const quantity = quantityText.trim().length === 0 ? Number.NaN : Number.parseFloat(quantityText);

  const localValidation = validateCreatePurchaseRequest({
    workPackageId,
    itemDescription,
    quantity,
    unit,
  });
  const canSubmit = !submitting && workPackages.length > 0 && localValidation.ok;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSavedAt(null);
    startSubmit(async () => {
      const result = await createPurchaseRequest({
        workPackageId,
        itemDescription,
        quantity,
        unit,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Pessimistic confirmation: only after the round-trip succeeded.
      // Clear the inputs so the form is ready for the next request; the
      // router.refresh() re-runs the Server Component so the "My
      // requests" list above us picks up the new row.
      setItemDescription("");
      setQuantityText("");
      setUnit("");
      setWorkPackageId("");
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  // Inline validation only after the user has touched the field (any
  // non-empty input). Same shape as DisplayNameForm — keeps an untouched
  // form quiet.
  const userTyped =
    workPackageId.length > 0 ||
    itemDescription.length > 0 ||
    quantityText.length > 0 ||
    unit.length > 0;
  const inlineError = error ?? (!localValidation.ok && userTyped ? localValidation.error : null);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="pr-wp" className="text-sm font-medium text-zinc-200">
          Work package
        </label>
        <select
          id="pr-wp"
          value={workPackageId}
          onChange={(e) => {
            setWorkPackageId(e.target.value);
            setError(null);
            setSavedAt(null);
          }}
          disabled={submitting || workPackages.length === 0}
          className="h-9 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 text-sm text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
        >
          <option value="">Select a work package…</option>
          {workPackages.map((wp) => (
            <option key={wp.id} value={wp.id}>
              {wp.code} · {wp.name}
            </option>
          ))}
        </select>
        {workPackages.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No work packages available — ask your project manager.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pr-item" className="text-sm font-medium text-zinc-200">
          Item description
        </label>
        <input
          id="pr-item"
          type="text"
          value={itemDescription}
          maxLength={500}
          onChange={(e) => {
            setItemDescription(e.target.value);
            setError(null);
            setSavedAt(null);
          }}
          disabled={submitting}
          className="h-9 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          placeholder="Cement bag 50kg"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="pr-qty" className="text-sm font-medium text-zinc-200">
            Quantity
          </label>
          <input
            id="pr-qty"
            type="text"
            inputMode="decimal"
            value={quantityText}
            onChange={(e) => {
              setQuantityText(e.target.value);
              setError(null);
              setSavedAt(null);
            }}
            disabled={submitting}
            className="h-9 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            placeholder="10"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="pr-unit" className="text-sm font-medium text-zinc-200">
            Unit
          </label>
          <input
            id="pr-unit"
            type="text"
            value={unit}
            maxLength={50}
            onChange={(e) => {
              setUnit(e.target.value);
              setError(null);
              setSavedAt(null);
            }}
            disabled={submitting}
            className="h-9 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            placeholder="bag"
          />
        </div>
      </div>

      {inlineError ? (
        <div
          role="alert"
          className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
        >
          {inlineError}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {savedAt !== null && !submitting ? (
          <span className="text-xs text-emerald-400" role="status">
            Saved
          </span>
        ) : null}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-100 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
