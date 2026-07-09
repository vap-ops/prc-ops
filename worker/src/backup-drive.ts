// Storage-bucket backup exporter (G1 — T0 data-safety floor).
//
// Nightly, mirror every object in the five Supabase Storage buckets into a
// Google Drive folder so the firm has an off-Supabase copy of its photos and
// documents. Supabase's daily DB backup does NOT include Storage objects
// (memory `supabase-free-tier`), so without this the photos — the SA's only
// real product (memory `sa-real-usage-photos-2026-07`) — have a single point
// of failure.
//
// Shape mirrors src/index.ts: run-once-and-exit. The worker has no in-process
// scheduler (README: "run-once-and-exit, not always-on"); Railway invokes it
// on a cron. This module is invoked by a SEPARATE nightly Railway cron
// (`30 0 * * *` — 00:30 UTC) via `pnpm backup`, independent of the report
// worker's cadence.
//
// Env contract (both required; unset either to disable — the toggle):
//   GDRIVE_SA_KEY    — Google service-account JSON. Raw JSON or base64 of it.
//   GDRIVE_FOLDER_ID — target Drive folder id (a Shared Drive folder is
//                      supported: the SA must be a member of that Shared Drive).
// Plus the worker's usual SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (supabase.ts).
//
// Never deletes anything in Drive — add/update only. After each run it writes
// <FOLDER_ID>/last-run.json, the operator-visible heartbeat.

import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { google } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "./supabase.js";
import type { Database } from "./database.types.js";

// The five buckets to mirror. Kept as a const list (config-ready per the
// automation-documentation doctrine — a future settings hub could tune it).
export const BACKUP_BUCKETS = [
  "photos",
  "reports",
  "po-attachments",
  "pr-attachments",
  "feedback-attachments",
] as const;

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const OCTET_STREAM = "application/octet-stream";
const JSON_CT = "application/json";
const LAST_RUN_NAME = "last-run.json";
// Supabase Storage `list` caps at 100 per page by default; we page explicitly.
const PAGE_SIZE = 100;

// --- shared types ----------------------------------------------------------

/** A flat storage object: full path within its bucket + byte size. */
export interface RemoteObject {
  path: string;
  size: number;
}

/** One entry from a single (non-recursive) storage `list` page. */
export interface RawStorageEntry {
  name: string;
  isFolder: boolean;
  size: number;
}

/** A file that already exists in Drive (only the fields the diff needs). */
export interface DriveFile {
  id: string;
  name: string;
  size: number;
}

/** Storage side of the mirror — the seam the tests fake. */
export interface StorageBackend {
  /** All objects in a bucket, recursively, as a flat list. */
  listObjects(bucket: string): Promise<RemoteObject[]>;
  /** Download one object's bytes. */
  download(bucket: string, path: string): Promise<Buffer>;
}

/** Drive side of the mirror — the seam the tests fake. Add/update only. */
export interface DriveBackend {
  /** Folder id of `name` directly under `parentId`, or null if absent. */
  findFolder(parentId: string, name: string): Promise<string | null>;
  /** Create folder `name` under `parentId`, returning its id. */
  createFolder(parentId: string, name: string): Promise<string>;
  /** Files (not folders) directly under `folderId`. */
  listFiles(folderId: string): Promise<DriveFile[]>;
  createFile(folderId: string, name: string, contentType: string, body: Buffer): Promise<void>;
  updateFile(fileId: string, contentType: string, body: Buffer): Promise<void>;
}

export interface BucketStat {
  files: number;
  uploaded: number;
  bytes: number;
}

export interface BackupSummary {
  timestamp: string;
  buckets: Record<string, BucketStat>;
  errors: string[];
}

export interface BackupConfig {
  folderId: string;
  credentials: Record<string, unknown>;
}

export interface RunBackupDeps {
  storage: StorageBackend;
  drive: DriveBackend;
  folderId: string;
  buckets: readonly string[];
  now?: () => Date;
  log?: (msg: string) => void;
}

// --- pure helpers (env-gating + diff decision) -----------------------------

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Parse the service-account key from env. Accepts raw JSON or base64-encoded
 * JSON (Railway env vars are easier to paste base64). Throws if it is neither.
 */
export function parseServiceAccountKey(raw: string): Record<string, unknown> {
  const asObject = (s: string): Record<string, unknown> | null => {
    try {
      const v: unknown = JSON.parse(s);
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  const trimmed = raw.trim();
  const direct = asObject(trimmed);
  if (direct) return direct;

  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  const viaBase64 = asObject(decoded);
  if (viaBase64) return viaBase64;

  throw new Error("GDRIVE_SA_KEY is neither valid JSON nor base64-encoded JSON");
}

/**
 * Read the backup config from env. Returns null (→ no-op) when either var is
 * missing/empty. Throws only when both are present but the key is malformed —
 * that is a misconfiguration the operator should see, not silently skip.
 */
export function loadBackupConfig(
  env: Record<string, string | undefined>,
): BackupConfig | null {
  const key = env["GDRIVE_SA_KEY"];
  const folderId = env["GDRIVE_FOLDER_ID"];
  if (!key || !folderId) return null;
  return { folderId, credentials: parseServiceAccountKey(key) };
}

/** Split "a/b/c.jpg" → { dirs: ["a","b"], filename: "c.jpg" }. */
export function splitObjectPath(path: string): { dirs: string[]; filename: string } {
  const parts = path.split("/");
  const filename = parts.pop() ?? path;
  return { dirs: parts, filename };
}

/** The mirror decision: create when absent, update when size differs, else skip. */
export function decideAction(
  existing: DriveFile | undefined,
  obj: RemoteObject,
): "create" | "update" | "skip" {
  if (!existing) return "create";
  if (existing.size !== obj.size) return "update";
  return "skip";
}

/**
 * Walk a bucket into a flat object list, paginating each folder and recursing
 * into subfolders. `list(prefix, offset)` returns one page of raw entries.
 */
export async function listBucketObjects(
  list: (prefix: string, offset: number) => Promise<RawStorageEntry[]>,
  pageSize: number = PAGE_SIZE,
): Promise<RemoteObject[]> {
  const out: RemoteObject[] = [];

  async function walk(prefix: string): Promise<void> {
    let offset = 0;
    for (;;) {
      const batch = await list(prefix, offset);
      for (const entry of batch) {
        const childPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFolder) {
          await walk(childPath);
        } else {
          out.push({ path: childPath, size: entry.size });
        }
      }
      if (batch.length < pageSize) break;
      offset += batch.length;
    }
  }

  await walk("");
  return out;
}

// --- orchestration (tested with faked backends) ----------------------------

export async function runBackup(deps: RunBackupDeps): Promise<BackupSummary> {
  const { storage, drive, folderId, buckets } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(m));

  // parentId/name → folderId, so a folder is looked up/created at most once.
  const folderIdCache = new Map<string, string>();
  // folderId → (filename → DriveFile), so a folder is listed at most once.
  const folderFilesCache = new Map<string, Map<string, DriveFile>>();

  async function ensureFolderPath(segments: string[]): Promise<string> {
    let parent = folderId;
    for (const seg of segments) {
      const cacheKey = `${parent}/${seg}`;
      let id = folderIdCache.get(cacheKey);
      if (id === undefined) {
        id = (await drive.findFolder(parent, seg)) ?? (await drive.createFolder(parent, seg));
        folderIdCache.set(cacheKey, id);
      }
      parent = id;
    }
    return parent;
  }

  async function getFolderFiles(fid: string): Promise<Map<string, DriveFile>> {
    let m = folderFilesCache.get(fid);
    if (m === undefined) {
      const files = await drive.listFiles(fid);
      m = new Map(files.map((f) => [f.name, f]));
      folderFilesCache.set(fid, m);
    }
    return m;
  }

  const summary: BackupSummary = { timestamp: now().toISOString(), buckets: {}, errors: [] };

  for (const bucket of buckets) {
    const stat: BucketStat = { files: 0, uploaded: 0, bytes: 0 };
    summary.buckets[bucket] = stat;

    let objects: RemoteObject[];
    try {
      objects = await storage.listObjects(bucket);
    } catch (e) {
      const msg = `list bucket ${bucket}: ${errMsg(e)}`;
      log(`drive backup: ${msg}`);
      summary.errors.push(msg);
      continue;
    }
    stat.files = objects.length;

    for (const obj of objects) {
      try {
        const { dirs, filename } = splitObjectPath(obj.path);
        const targetFolder = await ensureFolderPath([bucket, ...dirs]);
        const files = await getFolderFiles(targetFolder);
        const existing = files.get(filename);
        const action = decideAction(existing, obj);
        if (action === "skip") continue;

        const bytes = await storage.download(bucket, obj.path);
        if (action === "create") {
          await drive.createFile(targetFolder, filename, OCTET_STREAM, bytes);
        } else {
          // `existing` is defined whenever action === "update".
          await drive.updateFile(existing!.id, OCTET_STREAM, bytes);
        }
        stat.uploaded += 1;
        stat.bytes += obj.size;
      } catch (e) {
        const msg = `${bucket}/${obj.path}: ${errMsg(e)}`;
        log(`drive backup: ${msg}`);
        summary.errors.push(msg);
      }
    }

    log(
      `drive backup: ${bucket} — ${stat.files} file(s), ${stat.uploaded} uploaded, ${stat.bytes} bytes`,
    );
  }

  // Heartbeat: <FOLDER_ID>/last-run.json, created or updated in place.
  try {
    const body = Buffer.from(JSON.stringify(summary, null, 2), "utf8");
    const rootFiles = await getFolderFiles(folderId);
    const existing = rootFiles.get(LAST_RUN_NAME);
    if (existing) {
      await drive.updateFile(existing.id, JSON_CT, body);
    } else {
      await drive.createFile(folderId, LAST_RUN_NAME, JSON_CT, body);
    }
  } catch (e) {
    const msg = `write ${LAST_RUN_NAME}: ${errMsg(e)}`;
    log(`drive backup: ${msg}`);
    summary.errors.push(msg);
  }

  return summary;
}

// --- real backends (live network; not unit-tested) -------------------------

function sizeOf(entry: { id: string | null; metadata: unknown }): number {
  const md = entry.metadata as { size?: number } | null;
  return typeof md?.size === "number" ? md.size : 0;
}

function createStorageBackend(client: SupabaseClient<Database>): StorageBackend {
  return {
    async listObjects(bucket: string): Promise<RemoteObject[]> {
      const list = async (prefix: string, offset: number): Promise<RawStorageEntry[]> => {
        const { data, error } = await client.storage
          .from(bucket)
          .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(error.message);
        return (data ?? []).map((e) => ({
          name: e.name,
          // Supabase returns folders (common prefixes) with a null id.
          isFolder: e.id === null,
          size: sizeOf(e),
        }));
      };
      return listBucketObjects(list, PAGE_SIZE);
    },
    async download(bucket: string, path: string): Promise<Buffer> {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) throw new Error(error.message);
      if (!data) throw new Error("empty download response");
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

// Escape a value for a Drive query string literal ('...').
function driveQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

type GoogleAuthOptions = NonNullable<ConstructorParameters<typeof google.auth.GoogleAuth>[0]>;

function createDriveBackend(credentials: Record<string, unknown>): DriveBackend {
  const auth = new google.auth.GoogleAuth({
    credentials: credentials as NonNullable<GoogleAuthOptions["credentials"]>,
    scopes: [DRIVE_SCOPE],
  });
  const drive = google.drive({ version: "v3", auth });
  // supportsAllDrives + includeItemsFromAllDrives on every call so a Workspace
  // Shared Drive target works (files/folders in a Shared Drive are otherwise
  // invisible to the API).
  const listShared = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

  return {
    async findFolder(parentId: string, name: string): Promise<string | null> {
      const res = await drive.files.list({
        q: `${driveQuote(parentId)} in parents and name = ${driveQuote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: "files(id,name)",
        pageSize: 1,
        ...listShared,
      });
      return res.data.files?.[0]?.id ?? null;
    },

    async createFolder(parentId: string, name: string): Promise<string> {
      const res = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        fields: "id",
        supportsAllDrives: true,
      });
      const id = res.data.id;
      if (!id) throw new Error(`createFolder ${name}: Drive returned no id`);
      return id;
    },

    async listFiles(folderId: string): Promise<DriveFile[]> {
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `${driveQuote(folderId)} in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
          fields: "nextPageToken, files(id,name,size)",
          pageSize: 1000,
          ...(pageToken ? { pageToken } : {}),
          ...listShared,
        });
        for (const f of res.data.files ?? []) {
          if (f.id && typeof f.name === "string") {
            out.push({ id: f.id, name: f.name, size: f.size ? Number(f.size) : 0 });
          }
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },

    async createFile(
      folderId: string,
      name: string,
      contentType: string,
      body: Buffer,
    ): Promise<void> {
      await drive.files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType: contentType, body: Readable.from(body) },
        fields: "id",
        supportsAllDrives: true,
      });
    },

    async updateFile(fileId: string, contentType: string, body: Buffer): Promise<void> {
      await drive.files.update({
        fileId,
        media: { mimeType: contentType, body: Readable.from(body) },
        fields: "id",
        supportsAllDrives: true,
      });
    },
  };
}

// --- entry point -----------------------------------------------------------

export async function main(): Promise<void> {
  let config: BackupConfig | null;
  try {
    config = loadBackupConfig(process.env);
  } catch (e) {
    console.log(`drive backup: not configured (${errMsg(e)}), skipping`);
    return;
  }
  if (!config) {
    console.log("drive backup: not configured, skipping");
    return;
  }

  const supabase = createServiceRoleClient();
  const storage = createStorageBackend(supabase);
  const drive = createDriveBackend(config.credentials);

  console.log(`drive backup: starting — ${BACKUP_BUCKETS.length} bucket(s) → Drive ${config.folderId}`);
  const summary = await runBackup({
    storage,
    drive,
    folderId: config.folderId,
    buckets: BACKUP_BUCKETS,
  });

  const totals = Object.values(summary.buckets).reduce(
    (a, s) => ({ files: a.files + s.files, uploaded: a.uploaded + s.uploaded, bytes: a.bytes + s.bytes }),
    { files: 0, uploaded: 0, bytes: 0 },
  );
  console.log(
    `drive backup: done — ${totals.files} file(s), ${totals.uploaded} uploaded, ${totals.bytes} bytes, ${summary.errors.length} error(s)`,
  );
}

// Run only when executed directly (tsx src/backup-drive.ts), not when imported
// by the test suite. Standard ESM "is main module" check.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(errMsg(e));
    process.exitCode = 1;
  });
}
