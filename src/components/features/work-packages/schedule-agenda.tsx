"use client";

// Spec 256 U2 — week + day agendas. Week = 7 stacked day sections (compact
// chips); day = one date expanded into sections (มีงานจริง / ครบกำหนดวันนี้ /
// เริ่มตามแผน). Chips/rows link to WP detail with the schedule as back-referrer.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { workPackageHref, scheduleHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { weekOf, THAI_WEEKDAYS } from "@/lib/work-packages/calendar-grid";
import { THAI_MONTHS } from "@/lib/work-packages/gantt-scale";
import { groupPhotosByWp } from "@/lib/work-packages/day-photo-grouping";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import type { GanttWp } from "@/components/features/work-packages/schedule-gantt";
import type { SchedulePhotoEntry } from "@/app/projects/[projectId]/schedule/actions";

export interface DayEntries {
  /** WPs with photos that day + photo count. */
  active: Array<{ wp: GanttWp; photoCount: number }>;
  /** planned_end that day. */
  due: GanttWp[];
  /** planned_start that day. */
  starting: GanttWp[];
}

interface NavProps {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  prevLabel: string;
  nextLabel: string;
  title: string;
}

const NAV_BTN =
  "rounded-control text-ink-secondary hover:text-ink hover:bg-sunk focus-visible:ring-action inline-flex h-11 w-11 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2";

function AgendaNav({ onPrev, onNext, onToday, prevLabel, nextLabel, title }: NavProps) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={prevLabel} onClick={onPrev} className={NAV_BTN}>
        <ChevronLeft aria-hidden className="h-5 w-5" />
      </button>
      <p className="text-body text-ink min-w-28 text-center font-bold">{title}</p>
      <button type="button" aria-label={nextLabel} onClick={onNext} className={NAV_BTN}>
        <ChevronRight aria-hidden className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onToday}
        className="rounded-control border-edge bg-card text-ink-secondary hover:text-ink hover:bg-sunk focus-visible:ring-action text-meta ml-auto inline-flex h-11 items-center border px-3 font-semibold transition-colors focus:outline-none focus-visible:ring-2"
      >
        วันนี้
      </button>
    </div>
  );
}

function thaiDate(iso: string): string {
  const dow = new Date(Date.parse(`${iso}T00:00:00Z`)).getUTCDay();
  const day = Number(iso.slice(8, 10));
  const month = THAI_MONTHS[Number(iso.slice(5, 7)) - 1];
  return `${THAI_WEEKDAYS[dow]} ${day} ${month}`;
}

// Spec 257 — one shared skeleton while photos are minting (not per-WP; a
// single mount covers the whole visible day, which is what getByTestId in
// the RTL suite expects — exactly one match).
function PhotoSkeletonRow() {
  return (
    <div data-testid="photo-skeleton" className="flex gap-1.5">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="bg-sunk h-14 w-14 shrink-0 animate-pulse rounded-md" />
      ))}
    </div>
  );
}

function ThumbStrip({ photos }: { photos: ReadonlyArray<SchedulePhotoEntry> }) {
  if (photos.length === 0) return null;
  const fullUrls = photos.map((p) => p.fullUrl);
  const photoIds = photos.map((p) => p.photoId);
  const uploaderNames = photos.map((p) => p.uploaderName);
  return (
    <div className="flex [touch-action:pan-x_pinch-zoom] gap-1.5 overflow-x-auto">
      {photos.map((p, i) => (
        <div
          key={p.photoId}
          className="border-edge h-14 w-14 shrink-0 overflow-hidden rounded-md border"
        >
          <ZoomablePhoto
            src={p.thumbUrl}
            group={fullUrls}
            groupIndex={i}
            photoId={p.photoId}
            groupPhotoIds={photoIds}
            groupUploaderNames={uploaderNames}
          />
        </div>
      ))}
    </div>
  );
}

function WpLink({ projectId, wp, meta }: { projectId: string; wp: GanttWp; meta?: string }) {
  return (
    <Link
      href={withBackFrom(workPackageHref(projectId, wp.id), scheduleHref(projectId))}
      className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-control flex min-h-11 items-center gap-2 border px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <span className="text-ink-secondary text-meta shrink-0 font-mono">{wp.code}</span>
      <span className="text-ink text-body min-w-0 flex-1 truncate font-semibold">{wp.name}</span>
      {meta && <span className="text-ink-secondary text-meta shrink-0">{meta}</span>}
    </Link>
  );
}

// ---------------------------------------------------------------------------

interface ScheduleDayViewProps {
  projectId: string;
  iso: string;
  todayISO: string;
  entries: DayEntries;
  /** Spec 257 — this date's photos (already resolved; container owns the fetch). */
  photos: ReadonlyArray<SchedulePhotoEntry>;
  photosLoading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function ScheduleDayView({
  projectId,
  iso,
  todayISO,
  entries,
  photos,
  photosLoading,
  onPrev,
  onNext,
  onToday,
}: ScheduleDayViewProps) {
  const { byWp: photosByWp, extra: extraPhotos } = groupPhotosByWp(photos);
  const beYear = Number(iso.slice(0, 4)) + 543;
  const isEmpty =
    entries.active.length === 0 && entries.due.length === 0 && entries.starting.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <AgendaNav
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        prevLabel="วันก่อนหน้า"
        nextLabel="วันถัดไป"
        title={`${thaiDate(iso)} ${beYear}${iso === todayISO ? " (วันนี้)" : ""}`}
      />

      {isEmpty ? (
        <div className="border-edge bg-card text-ink-secondary rounded-card text-body border p-6 text-center">
          ไม่มีข้อมูลในวันนี้ — แตะลูกศรเพื่อดูวันอื่น หรือกลับไปมุมมองเดือน
        </div>
      ) : (
        <>
          {entries.active.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-meta text-ink-secondary font-bold">มีงานจริง</h3>
              {entries.active.map(({ wp, photoCount }) => (
                <div key={wp.id} className="flex flex-col gap-1.5">
                  <WpLink projectId={projectId} wp={wp} meta={`${photoCount} รูป`} />
                  {photosLoading ? (
                    <PhotoSkeletonRow />
                  ) : (
                    <ThumbStrip photos={photosByWp.get(wp.id) ?? []} />
                  )}
                </div>
              ))}
              {!photosLoading && extraPhotos > 0 && (
                <p className="text-meta text-ink-secondary">+{extraPhotos} รูปเพิ่มเติมในวันนี้</p>
              )}
            </section>
          )}
          {entries.due.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-meta text-ink-secondary font-bold">ครบกำหนดวันนี้</h3>
              {entries.due.map((wp) => (
                <WpLink key={wp.id} projectId={projectId} wp={wp} />
              ))}
            </section>
          )}
          {entries.starting.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-meta text-ink-secondary font-bold">เริ่มตามแผน</h3>
              {entries.starting.map((wp) => (
                <WpLink key={wp.id} projectId={projectId} wp={wp} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ScheduleWeekViewProps {
  projectId: string;
  anchorIso: string;
  todayISO: string;
  entriesFor: (iso: string) => DayEntries;
  /** Spec 257 — that date's photos (container owns the fetch). */
  photosFor: (iso: string) => ReadonlyArray<SchedulePhotoEntry>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function ScheduleWeekView({
  projectId,
  anchorIso,
  todayISO,
  entriesFor,
  photosFor,
  onPrev,
  onNext,
  onToday,
}: ScheduleWeekViewProps) {
  const days = weekOf(anchorIso);
  const first = days[0]!;
  const last = days[6]!;
  const title = `${Number(first.slice(8, 10))}–${Number(last.slice(8, 10))} ${
    THAI_MONTHS[Number(last.slice(5, 7)) - 1]
  } ${Number(last.slice(0, 4)) + 543}`;

  return (
    <div className="flex flex-col gap-3">
      <AgendaNav
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        prevLabel="สัปดาห์ก่อนหน้า"
        nextLabel="สัปดาห์ถัดไป"
        title={title}
      />

      <div className="flex flex-col gap-2">
        {days.map((iso) => {
          const e = entriesFor(iso);
          const { byWp: dayPhotosByWp } = groupPhotosByWp(photosFor(iso));
          const isToday = iso === todayISO;
          const empty = e.active.length === 0 && e.due.length === 0 && e.starting.length === 0;
          return (
            <div
              key={iso}
              className={`border-edge rounded-card border ${isToday ? "bg-attn-soft/30" : "bg-card"} ${
                empty ? "py-1.5" : "py-2"
              } px-3`}
            >
              <p className={`text-meta font-bold ${isToday ? "text-ink" : "text-ink-secondary"}`}>
                {thaiDate(iso)}
                {isToday && " · วันนี้"}
              </p>
              {!empty && (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {e.active.map(({ wp, photoCount }) => {
                    const first = dayPhotosByWp.get(wp.id)?.[0];
                    return (
                      <div key={`a-${wp.id}`} className="flex items-center gap-1.5">
                        {first && (
                          <div className="border-edge h-10 w-10 shrink-0 overflow-hidden rounded-md border">
                            <ZoomablePhoto
                              src={first.thumbUrl}
                              photoId={first.photoId}
                              uploaderName={first.uploaderName}
                            />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <WpLink projectId={projectId} wp={wp} meta={`${photoCount} รูป`} />
                        </div>
                      </div>
                    );
                  })}
                  {e.due.map((wp) => (
                    <WpLink key={`d-${wp.id}`} projectId={projectId} wp={wp} meta="ครบกำหนด" />
                  ))}
                  {e.starting.map((wp) => (
                    <WpLink key={`s-${wp.id}`} projectId={projectId} wp={wp} meta="เริ่มตามแผน" />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
