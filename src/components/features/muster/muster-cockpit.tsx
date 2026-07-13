"use client";

// Spec 306 U3 — the muster cockpit. At the morning talk the SA forms teams behind
// their หัวหน้า and checks members in (and out in the evening). One screen, a
// เข้า/ออก mode toggle. Attendance is recorded through the muster RPCs (scan-in =
// presence + team membership; the WP set = the Site Owner's announcement). The QR
// camera (BarcodeDetector) is an accelerator; manual tap-add is always present so a
// lost/phoneless badge is never "absent". Money (labor cost) is derived later at
// ปิดวัน (U5) — this screen never touches it.

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatThaiDate } from "@/lib/i18n/labels";
import { openMusterTeam, musterScan, setMusterTeamWps, closeMusterDay } from "@/lib/muster/actions";
import type { MusterBoard, MusterTeam, MusterWp } from "@/lib/muster/load-muster";
import { MusterCamera } from "./muster-camera";

type Mode = "in" | "out";

function bangkokTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

const TOGGLE_ON = "bg-accent text-on-accent";
const TOGGLE_OFF = "bg-sunk text-ink-secondary";
const CHIP = "bg-sunk text-ink-secondary text-meta rounded-full px-2.5 py-1 font-semibold";

// Client-only feature detection (BarcodeDetector = Android/PWA). useSyncExternalStore
// keeps SSR + hydration snapshots false, then reads the real value on the client —
// hydration-safe and without a setState-in-effect (react-hooks/set-state-in-effect).
const subscribeNoop = () => () => {};
const hasBarcodeDetector = () => typeof window !== "undefined" && "BarcodeDetector" in window;

export function MusterCockpit({
  projectId,
  date,
  revalidate,
  board,
}: {
  projectId: string;
  date: string;
  revalidate: string;
  board: MusterBoard;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("in");
  const [leadPick, setLeadPick] = useState("");
  const [scanTeamId, setScanTeamId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pending, startTransition] = useTransition();
  const hasCamera = useSyncExternalStore(subscribeNoop, hasBarcodeDetector, () => false);

  const musteredIds = new Set(board.teams.flatMap((t) => t.members.map((m) => m.workerId)));
  const leadIds = new Set(board.teams.map((t) => t.leadWorkerId));
  const availableLeads = board.workers.filter((w) => !leadIds.has(w.id));
  // A worker is addable to team T if not already mustered AND not the lead of
  // ANOTHER team (their own lead may be scanned into their own team). Excluding
  // all leadIds globally would wrongly block adding a lead to their own team.
  const addableTo = (teamId: string) => {
    const otherLeads = new Set(
      board.teams.filter((t) => t.id !== teamId).map((t) => t.leadWorkerId),
    );
    return board.workers.filter((w) => !musteredIds.has(w.id) && !otherLeads.has(w.id));
  };

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setMessage(res.error ?? "เช็คชื่อไม่สำเร็จ");
      else {
        setMessage(null);
        router.refresh();
      }
    });
  }

  const openTeam = () => {
    if (!leadPick) return;
    run(async () => {
      const res = await openMusterTeam({ projectId, date, leadWorkerId: leadPick, revalidate });
      if (res.ok) setLeadPick("");
      return res;
    });
  };

  const scan = (teamId: string, workerId: string, method: "qr" | "manual") =>
    run(() => musterScan({ teamId, workerId, mode, method, revalidate }));

  const saveWps = (teamId: string, wpIds: string[]) =>
    run(() => setMusterTeamWps({ teamId, wpIds, revalidate }));

  const closeDay = () => {
    setConfirmClose(false);
    run(() => closeMusterDay({ projectId, date, revalidate }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-ink font-semibold">{formatThaiDate(date)}</p>
        <div className="flex overflow-hidden rounded-full">
          <button
            type="button"
            onClick={() => setMode("in")}
            className={`min-h-11 px-4 text-sm font-bold ${mode === "in" ? TOGGLE_ON : TOGGLE_OFF}`}
          >
            เข้า
          </button>
          <button
            type="button"
            onClick={() => setMode("out")}
            className={`min-h-11 px-4 text-sm font-bold ${mode === "out" ? TOGGLE_ON : TOGGLE_OFF}`}
          >
            ออก
          </button>
        </div>
      </div>

      {board.closure ? (
        <p className="border-edge bg-sunk text-ink-secondary rounded-card border px-3 py-2 text-sm font-semibold">
          ปิดวันแล้ว · {bangkokTime(board.closure.closedAt)}
        </p>
      ) : null}

      {message ? (
        <p role="alert" className="bg-danger-soft text-danger-ink rounded-card px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <div className="border-edge bg-card rounded-card flex flex-wrap items-center gap-2 border px-4 py-3">
        <select
          aria-label="เลือกหัวหน้าทีม"
          value={leadPick}
          onChange={(e) => setLeadPick(e.target.value)}
          className="border-edge bg-surface text-ink min-h-11 flex-1 rounded-lg border px-3 text-sm"
        >
          <option value="">เลือกหัวหน้าทีม…</option>
          {availableLeads.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={openTeam}
          disabled={!leadPick || pending}
          className="bg-accent text-on-accent min-h-11 rounded-lg px-4 text-sm font-bold disabled:opacity-50"
        >
          เปิดทีม
        </button>
      </div>

      {board.teams.length === 0 ? (
        <p className="text-ink-muted text-sm">ยังไม่มีทีมวันนี้ — เลือกหัวหน้าทีมเพื่อเปิดทีมแรก</p>
      ) : (
        board.teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            wps={board.wps}
            mode={mode}
            pending={pending}
            availableToAdd={addableTo(team.id)}
            hasCamera={hasCamera}
            onScan={scan}
            onSaveWps={saveWps}
            onOpenCamera={() => setScanTeamId(team.id)}
          />
        ))
      )}

      {board.teams.length > 0 ? (
        <div className="pt-2">
          {confirmClose ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeDay}
                disabled={pending}
                className="bg-danger text-on-fill hover:bg-danger-strong min-h-11 flex-1 rounded-lg px-4 text-sm font-bold disabled:opacity-50"
              >
                ยืนยันปิดวัน
              </button>
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="bg-sunk text-ink min-h-11 rounded-lg px-4 text-sm font-bold"
              >
                ยกเลิก
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              disabled={pending}
              className="bg-sunk text-ink min-h-11 w-full rounded-lg px-4 text-sm font-bold disabled:opacity-50"
            >
              {board.closure ? "ปิดวันอีกครั้ง" : "ปิดวัน"}
            </button>
          )}
        </div>
      ) : null}

      {scanTeamId ? (
        <MusterCamera
          onDetected={(workerId) => {
            scan(scanTeamId, workerId, "qr");
            setScanTeamId(null);
          }}
          onClose={() => setScanTeamId(null)}
        />
      ) : null}
    </div>
  );
}

function TeamCard({
  team,
  wps,
  mode,
  pending,
  availableToAdd,
  hasCamera,
  onScan,
  onSaveWps,
  onOpenCamera,
}: {
  team: MusterTeam;
  wps: MusterWp[];
  mode: Mode;
  pending: boolean;
  availableToAdd: { id: string; name: string }[];
  hasCamera: boolean;
  onScan: (teamId: string, workerId: string, method: "qr" | "manual") => void;
  onSaveWps: (teamId: string, wpIds: string[]) => void;
  onOpenCamera: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set(team.wpIds));

  const openEditor = () => {
    setChecked(new Set(team.wpIds));
    setEditOpen((v) => !v);
  };
  const toggleWp = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const wpById = new Map(wps.map((w) => [w.id, w]));

  return (
    <section data-testid={`team-${team.id}`} className="border-edge bg-card rounded-card border">
      <div className="border-edge flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="bg-brand text-on-brand text-meta rounded-full px-2 py-0.5 font-bold">
            หัวหน้า
          </span>
          <span className="text-ink font-semibold">{team.leadName}</span>
        </div>
        <span className="text-ink-muted text-meta">{team.members.length} คน</span>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {team.wpIds.length ? (
            team.wpIds.map((id) => (
              <span key={id} className={CHIP}>
                {wpById.get(id)?.code ?? "?"}
              </span>
            ))
          ) : (
            <span className="text-ink-muted text-meta">ยังไม่ระบุงาน</span>
          )}
          <button
            type="button"
            onClick={openEditor}
            className="text-accent text-meta font-semibold underline"
          >
            แก้ไขงาน
          </button>
        </div>

        {editOpen ? (
          <div className="border-edge bg-sunk rounded-lg border p-3">
            <div className="flex flex-col gap-2">
              {wps.map((wp) => (
                <label key={wp.id} className="text-ink flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked.has(wp.id)}
                    onChange={() => toggleWp(wp.id)}
                  />
                  <span>
                    {wp.code} {wp.name}
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                onSaveWps(team.id, [...checked]);
                setEditOpen(false);
              }}
              disabled={pending}
              className="bg-accent text-on-accent mt-3 min-h-11 rounded-lg px-3 text-sm font-bold disabled:opacity-50"
            >
              บันทึกงาน
            </button>
          </div>
        ) : null}

        <ul className="flex flex-col gap-1.5">
          {team.members.map((m) => (
            <li key={m.workerId} className="flex items-center justify-between gap-2">
              <span className="text-ink text-sm">{m.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-ink-muted text-meta tabular-nums">
                  {bangkokTime(m.inAt)}
                  {m.outAt ? ` – ${bangkokTime(m.outAt)}` : ""}
                  {m.outAt && m.outAuto ? " (อัตโนมัติ)" : ""}
                  {m.otHours ? ` · OT ${m.otHours} ชม.` : ""}
                </span>
                {mode === "out" && m.inAt && !m.outAt ? (
                  <button
                    type="button"
                    onClick={() => onScan(team.id, m.workerId, "manual")}
                    disabled={pending}
                    className="bg-sunk text-ink min-h-11 rounded-lg px-2.5 text-xs font-bold disabled:opacity-50"
                  >
                    เช็คออก
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {mode === "in" ? (
          <div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAddOpen((v) => !v)}
                className="bg-sunk text-ink min-h-11 rounded-lg px-3 text-sm font-bold"
              >
                + เพิ่มช่าง
              </button>
              {hasCamera ? (
                <button
                  type="button"
                  onClick={onOpenCamera}
                  className="bg-accent text-on-accent min-h-11 rounded-lg px-3 text-sm font-bold"
                >
                  สแกน QR
                </button>
              ) : null}
            </div>
            {addOpen ? (
              <div className="border-edge bg-sunk mt-2 flex flex-wrap gap-2 rounded-lg border p-2">
                {availableToAdd.length ? (
                  availableToAdd.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => onScan(team.id, w.id, "manual")}
                      disabled={pending}
                      className="bg-card text-ink border-edge min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50"
                    >
                      {w.name}
                    </button>
                  ))
                ) : (
                  <span className="text-ink-muted text-meta">ช่างทุกคนเข้าทีมแล้ว</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
