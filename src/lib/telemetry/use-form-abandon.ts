"use client";

// Spec 244 U2b-3 / ADR 0068 (Tier B) — a reusable friction hook: report
// `form_abandon` when a user began filling a form but left WITHOUT a successful
// submit (a form too long/confusing to finish). It fires on unmount (in-app
// navigation away / teardown) iff the caller marked the form dirty and did NOT mark
// it submitted. The caller wires two signals: `markDirty()` on first real input,
// `markSubmitted()` on a successful submit.
//
// PDPA-min (spec 244 D5): emits a STABLE form id ONLY — never field content. Routes
// through the friction bridge, so it no-ops when capture is inactive (before consent
// / non-trackable routes / external portals) and is best-effort (never throws into
// the form). Refs (not state) so marking never re-renders the form.

import { useEffect, useRef } from "react";
import { trackFriction } from "./friction";

export interface FormAbandonHandle {
  markDirty: () => void;
  markSubmitted: () => void;
}

export function useFormAbandon(formId: string): FormAbandonHandle {
  const dirty = useRef(false);
  const submitted = useRef(false);
  // Capture the id at MOUNT — a form's identity is fixed for its lifetime. Reading
  // `formId` directly with a `[formId]` dep would run the cleanup on any id change,
  // spuriously emitting an abandon; the empty dep array fires cleanup only on unmount.
  const formIdRef = useRef(formId);

  useEffect(() => {
    const id = formIdRef.current; // snapshot into the effect (mount value, stable)
    return () => {
      if (dirty.current && !submitted.current) {
        trackFriction("form_abandon", { form: id });
      }
    };
  }, []);

  return {
    markDirty: () => {
      dirty.current = true;
    },
    markSubmitted: () => {
      submitted.current = true;
    },
  };
}
