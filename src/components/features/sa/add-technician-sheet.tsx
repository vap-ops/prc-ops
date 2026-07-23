"use client";

// Spec 298 U2 — the single "เพิ่มช่างใหม่" front door on /sa/crew. The crew page body
// is existing-member management; adding a new ช่าง is this one deliberate action. It
// branches on whether the worker has a phone:
//   มีมือถือ  — render the project's self-onboard QR (passed from the server page) +
//              coaching. The worker self-registers (spec 296) and keys their OWN bank
//              privately on their own device — bank PII never touches the SA.
//   ไม่มีมือถือ — the capture-blind add: identity + a REQUIRED passbook photo. The photo
//              uploads to the walled sa-bank-capture/ path (deny-by-default read, so the
//              SA can't open it back), then addProjectWorkerWithBank creates the phoneless
//              worker + a pending_pm capture. A PM transcribes the bank later (spec 298 U3).
// The SA sets NO bank and NO pay/level (ADR 0079). 'use client': open + branch state and
// the upload state machine.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { UserPlus, ScanLine, Camera, Building2, Users, Printer, Share2 } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { photoExtToMime } from "@/lib/photos/path";
import { classifyStorageUploadError } from "@/lib/photos/upload-queue";
import { CONTACT_DOCS_BUCKET } from "@/lib/storage/buckets";
import { saBankCapturePath } from "@/lib/sa/sa-bank-capture-path";
import { addProjectWorkerWithBank } from "@/app/sa/crew/actions";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_STACKED, FIELD_SELECT } from "@/lib/ui/classes";
import {
  ADD_TECHNICIAN_LABEL,
  ADD_TECHNICIAN_HAS_PHONE_LABEL,
  ADD_TECHNICIAN_NO_PHONE_LABEL,
  ADD_TECHNICIAN_HAS_PHONE_HINT,
  ADD_TECHNICIAN_NO_PHONE_HINT,
  PASSBOOK_PHOTO_LABEL,
  TEAM_JOIN_SELECT_LABEL,
  TEAM_PRC_LABEL,
  TEAM_PRC_HINT,
  SUBCON_TEAM_HINT,
  SUBCON_JOIN_PREFIX,
  SUBCON_POSTER_LABEL,
  SUBCON_LINE_SHARE_LABEL,
  REGISTER_PREP_POSTER_LINE,
} from "@/lib/i18n/labels";

export interface AddTechnicianQrCard {
  project: { id: string; name: string };
  url: string;
  /** Pre-rendered QR as an inline SVG string (built server-side in /sa/crew). */
  svg: string;
}

// Spec 328 U2 — one card per (active contractor × project): the bank-free
// subcon-member onboarding QR. Same URL family as the PRC QR + ?contractor/&firm.
export interface SubconFirmQrCard {
  contractor: { id: string; name: string };
  project: { id: string; name: string };
  url: string;
  svg: string;
}

type Mode = "choose" | "has_phone" | "no_phone";
/** "prc" = today's pipeline; otherwise the selected contractor id. */
type Team = "prc" | string;

// Spec 334 U3 — the /team hub opens this ONE sheet from two tiles (เพิ่มช่าง →
// "choose", QR สมัคร → "has_phone"). Those tiles are rendered inside the server tile
// grid (icons + labels), so they can't hold the client open() directly; a context
// lets the sheet publish open() and the tile buttons consume it — one sheet, N
// openers, and nothing but strings/elements crosses the RSC boundary.
type OpenSheet = (mode: "choose" | "has_phone") => void;
const OpenSheetContext = createContext<OpenSheet | null>(null);

/**
 * A grid tile that opens the shared AddTechnicianSheet in a given mode. The visual
 * (icon + label) is server-rendered by the tile grid and handed in as `children`,
 * so this client button carries only the mode + the shared tile className — no icon
 * component crosses the server→client boundary.
 */
export function SheetOpenerButton({
  mode,
  className,
  children,
}: {
  mode: "choose" | "has_phone";
  className: string;
  children: ReactNode;
}) {
  const open = useContext(OpenSheetContext);
  return (
    <button type="button" onClick={() => open?.(mode)} className={className}>
      {children}
    </button>
  );
}

export function AddTechnicianSheet({
  projects,
  qrCards,
  firmQrCards = [],
  initialMode = "choose",
  children,
}: {
  projects: { id: string; code: string; name: string }[];
  qrCards: AddTechnicianQrCard[];
  firmQrCards?: SubconFirmQrCard[];
  /** The mode the DEFAULT trigger opens in (spec 334 U3). The /team hub instead
   * passes `children` and opens each tile with an explicit mode via context. */
  initialMode?: "choose" | "has_phone";
  /** When provided, renders in place of the default trigger button; its
   * SheetOpenerButton tiles open the sheet via context (one sheet, two openers). */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<Team>("prc");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [name, setName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [dob, setDob] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const nidOk = /^\d{13}$/.test(nationalId);
  const canSubmit =
    name.trim().length > 0 && nidOk && dob.length > 0 && projectId.length > 0 && photo !== null;

  function reset() {
    setTeam("prc");
    setMode(initialMode);
    setName("");
    setNationalId("");
    setDob("");
    setPhoto(null);
    setError(null);
    setBusy(false);
  }
  function close() {
    setOpen(false);
    reset();
  }

  async function submitNoPhone() {
    if (!photo) return;
    setError(null);
    setBusy(true);

    const prepared = await preparePhotoForUpload(photo);
    if (!prepared) {
      setBusy(false);
      setError("ไฟล์รูปไม่รองรับ กรุณาเลือกรูปภาพ (JPEG, PNG, WebP, HEIC)");
      return;
    }
    const path = saBankCapturePath(prepared.ext);
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(CONTACT_DOCS_BUCKET)
      .upload(path, prepared.blob, { upsert: false, contentType: photoExtToMime(prepared.ext) });
    if (uploadError && !classifyStorageUploadError(uploadError).alreadyExists) {
      setBusy(false);
      setError("อัปโหลดรูปสมุดบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      return;
    }

    const res = await addProjectWorkerWithBank({
      projectId,
      name: name.trim(),
      nationalId,
      dob,
      photoPath: path,
    });
    setBusy(false);
    if (res.ok) {
      close();
      startRefresh(() => router.refresh());
    } else {
      setError(res.error);
    }
  }

  const activeQr = qrCards.find((c) => c.project.id === projectId) ?? qrCards[0] ?? null;
  // Firms present on ANY project card (order preserved from the server fetch).
  const firms = firmQrCards.reduce<{ id: string; name: string }[]>((acc, c) => {
    if (!acc.some((f) => f.id === c.contractor.id)) acc.push(c.contractor);
    return acc;
  }, []);
  const activeFirmQr =
    team === "prc"
      ? null
      : (firmQrCards.find((c) => c.contractor.id === team && c.project.id === projectId) ??
        firmQrCards.find((c) => c.contractor.id === team) ??
        null);

  // Spec 328 U2b (operator UX call): accordion — the active team's content renders
  // directly UNDER its own row, not below the whole selector list (with 9+ firms
  // the QR otherwise lands off-screen). One open panel at a time; auto-scroll the
  // freshly opened panel into view when it expands near the sheet bottom.
  const nested = firms.length > 0;
  const panelClass = nested
    ? "border-edge ml-1.5 flex flex-col gap-3 border-l pl-3"
    : "flex flex-col gap-3";
  const activePanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open && nested)
      activePanelRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [team, open, nested]);

  function openWith(m: "choose" | "has_phone") {
    setMode(m);
    setOpen(true);
  }

  return (
    <>
      {children ? (
        <OpenSheetContext.Provider value={openWith}>{children}</OpenSheetContext.Provider>
      ) : (
        <button type="button" onClick={() => openWith(initialMode)} className={BUTTON_PRIMARY}>
          <UserPlus aria-hidden className="size-5 shrink-0" />
          {ADD_TECHNICIAN_LABEL}
        </button>
      )}

      <BottomSheet open={open} title={ADD_TECHNICIAN_LABEL} onClose={close}>
        <div className="flex flex-col gap-4">
          {projects.length > 1 ? (
            <label className="text-ink-secondary block text-sm">
              โครงการ
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={FIELD_SELECT}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="flex flex-col gap-2">
            {nested ? (
              <>
                <p className="text-ink-secondary text-sm">{TEAM_JOIN_SELECT_LABEL}</p>
                <button
                  type="button"
                  aria-pressed={team === "prc"}
                  onClick={() => {
                    setTeam("prc");
                    setMode("choose");
                  }}
                  className={`${BUTTON_SECONDARY} h-auto min-h-11 justify-start py-2 ${team === "prc" ? "border-action" : ""}`}
                >
                  <Building2 aria-hidden className="size-5 shrink-0" />
                  <span className="min-w-0 text-left">
                    {TEAM_PRC_LABEL}
                    <span className="text-ink-muted block text-xs font-normal">
                      {TEAM_PRC_HINT}
                    </span>
                  </span>
                </button>
              </>
            ) : null}

            {team === "prc" ? (
              <div ref={activePanelRef} className={panelClass}>
                {mode === "choose" ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-ink-secondary text-sm">ช่างคนนี้มีมือถือไหม?</p>
                    <button
                      type="button"
                      onClick={() => setMode("has_phone")}
                      className={`${BUTTON_SECONDARY} justify-start`}
                    >
                      <ScanLine aria-hidden className="size-5 shrink-0" />
                      {ADD_TECHNICIAN_HAS_PHONE_LABEL}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("no_phone")}
                      className={`${BUTTON_SECONDARY} justify-start`}
                    >
                      <Camera aria-hidden className="size-5 shrink-0" />
                      {ADD_TECHNICIAN_NO_PHONE_LABEL}
                    </button>
                  </div>
                ) : null}

                {mode === "has_phone" ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-ink-secondary self-start text-sm">
                      {ADD_TECHNICIAN_HAS_PHONE_HINT}
                    </p>
                    {activeQr ? (
                      <>
                        <div
                          className="rounded-lg bg-white p-3"
                          aria-label={`QR สมัครเป็นช่าง — ${activeQr.project.name}`}
                          dangerouslySetInnerHTML={{ __html: activeQr.svg }}
                        />
                        <p className="text-ink-muted text-meta text-center break-all">
                          {activeQr.url}
                        </p>
                      </>
                    ) : (
                      <p className="text-ink-muted text-sm">ยังไม่มีโครงการสำหรับสร้าง QR</p>
                    )}
                  </div>
                ) : null}

                {mode === "no_phone" ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-ink-secondary text-sm">{ADD_TECHNICIAN_NO_PHONE_HINT}</p>
                    <label className="text-ink-secondary block text-sm">
                      ชื่อ–สกุล
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={120}
                        className={FIELD_STACKED}
                      />
                    </label>
                    <label className="text-ink-secondary block text-sm">
                      เลขบัตรประชาชน (13 หลัก)
                      <input
                        inputMode="numeric"
                        value={nationalId}
                        onChange={(e) =>
                          setNationalId(e.target.value.replace(/\D/g, "").slice(0, 13))
                        }
                        className={FIELD_STACKED}
                      />
                    </label>
                    <label className="text-ink-secondary block text-sm">
                      วันเกิด
                      <input
                        type="date"
                        value={dob}
                        onChange={(e) => setDob(e.target.value)}
                        className={FIELD_STACKED}
                      />
                    </label>
                    <label className="text-ink-secondary block text-sm">
                      {PASSBOOK_PHOTO_LABEL}
                      <input
                        type="file"
                        accept="image/*"
                        aria-label={PASSBOOK_PHOTO_LABEL}
                        onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                        className={FIELD_STACKED}
                      />
                    </label>
                    {photo ? <p className="text-ink-muted text-meta">แนบรูปสมุดบัญชีแล้ว</p> : null}
                    {error ? <p className="text-danger text-sm">{error}</p> : null}
                    <button
                      type="button"
                      disabled={busy || !canSubmit}
                      onClick={() => void submitNoPhone()}
                      className={BUTTON_PRIMARY}
                    >
                      {busy ? "กำลังบันทึก…" : "เพิ่มช่างเข้าทีม"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {firms.map((f) => (
              <div key={f.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-pressed={team === f.id}
                  onClick={() => setTeam(f.id)}
                  className={`${BUTTON_SECONDARY} h-auto min-h-11 justify-start py-2 ${team === f.id ? "border-action" : ""}`}
                >
                  <Users aria-hidden className="size-5 shrink-0" />
                  <span className="min-w-0 text-left">
                    {f.name}
                    <span className="text-ink-muted block text-xs font-normal">
                      {SUBCON_TEAM_HINT}
                    </span>
                  </span>
                </button>
                {team === f.id ? (
                  <div ref={activePanelRef} className={`${panelClass} items-center`}>
                    {activeFirmQr ? (
                      <>
                        <div
                          className="rounded-lg bg-white p-3"
                          aria-label={`QR ${SUBCON_JOIN_PREFIX} ${activeFirmQr.contractor.name} — ${activeFirmQr.project.name}`}
                          dangerouslySetInnerHTML={{ __html: activeFirmQr.svg }}
                        />
                        <p className="text-ink text-center text-sm font-semibold">
                          {SUBCON_JOIN_PREFIX} {activeFirmQr.contractor.name}
                        </p>
                        <p className="text-ink-muted text-meta text-center break-all">
                          {activeFirmQr.url}
                        </p>
                        <div className="flex w-full flex-col gap-2">
                          <a
                            href={`/team/poster?contractor=${activeFirmQr.contractor.id}&project=${activeFirmQr.project.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className={`${BUTTON_SECONDARY} justify-center`}
                          >
                            <Printer aria-hidden className="size-5 shrink-0" />
                            {SUBCON_POSTER_LABEL}
                          </a>
                          <a
                            // Spec 343 U3 — lead the forwarded text with the
                            // "bring your ID card" line so the recipient reads it
                            // before opening the QR.
                            href={`https://line.me/R/share?text=${encodeURIComponent(`${REGISTER_PREP_POSTER_LINE}\n${activeFirmQr.url}`)}`}
                            target="_blank"
                            rel="noreferrer"
                            className={`${BUTTON_SECONDARY} justify-center`}
                          >
                            <Share2 aria-hidden className="size-5 shrink-0" />
                            {SUBCON_LINE_SHARE_LABEL}
                          </a>
                        </div>
                      </>
                    ) : (
                      <p className="text-ink-muted text-sm">ยังไม่มีโครงการสำหรับสร้าง QR</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
