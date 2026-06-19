"use client";

// Spec 151 — defer the offline-queue drain bundle off every page's first paint.
// UploadQueueRunner (spec 35) is mounted in the root layout and imports the
// browser supabase client, which transitively pulls in supabase-js + zod (env
// validation) ~125kb gz — onto every page's critical path. It is a BACKGROUND
// drainer for LEFTOVER uploads (renders nothing unless the queue has items), so
// loading it a beat after hydration is harmless (replay is idempotent, ADR 0039;
// the in-page phase-uploader is unaffected).
//
// 'use client' justification (CLAUDE.md): next/dynamic({ ssr: false }) must be
// called from a Client Component. ssr:false keeps the runner out of the server
// render and the initial JS; it hydrates lazily.

import dynamic from "next/dynamic";

const UploadQueueRunner = dynamic(
  () => import("./upload-queue-runner").then((m) => m.UploadQueueRunner),
  { ssr: false },
);

export function UploadQueueRunnerLazy() {
  return <UploadQueueRunner />;
}
