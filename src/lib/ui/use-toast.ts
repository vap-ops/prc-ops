"use client";

// Spec 76 (app-feel slice 1) — the toast hook + context. Split from the
// provider so any client component can import useToast without pulling the
// viewport renderer. Outside a provider the context is a NO-OP API (never
// throws) so components that fire toasts stay renderable in tests and degrade
// safely if the provider is ever absent — the provider is mounted once at the
// root layout, so in the running app the real API is always present.

import { createContext, useContext } from "react";

export type ToastVariant = "success" | "error";

export interface ToastOptions {
  durationMs?: number;
}

export interface ToastApi {
  toast: (message: string, opts?: ToastOptions & { variant?: ToastVariant }) => string;
  success: (message: string, opts?: ToastOptions) => string;
  error: (message: string, opts?: ToastOptions) => string;
  dismiss: (id: string) => void;
  /**
   * Adapter for the canonical server-action result shape
   * ({ ok: true } | { ok: false; error: string }) — ok → success(okMessage),
   * !ok → error(result.error). One-liner adoption for every action surface;
   * returns the new toast id (matching the sibling methods).
   */
  fromResult: (result: { ok: true } | { ok: false; error: string }, okMessage: string) => string;
}

const NOOP: ToastApi = {
  toast: () => "",
  success: () => "",
  error: () => "",
  dismiss: () => {},
  fromResult: () => "",
};

export const ToastContext = createContext<ToastApi>(NOOP);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
