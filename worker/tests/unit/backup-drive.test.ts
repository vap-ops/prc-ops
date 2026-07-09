import { describe, expect, it } from "vitest";
import {
  decideAction,
  listBucketObjects,
  loadBackupConfig,
  parseServiceAccountKey,
  runBackup,
  splitObjectPath,
  type DriveBackend,
  type DriveFile,
  type RawStorageEntry,
  type RemoteObject,
  type StorageBackend,
} from "../../src/backup-drive.js";

// A minimal service-account JSON — only the shape parseServiceAccountKey cares
// about (a JSON object). Not a real key.
const SA_JSON = JSON.stringify({
  type: "service_account",
  client_email: "x@y.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
});

describe("parseServiceAccountKey", () => {
  it("parses raw JSON", () => {
    const c = parseServiceAccountKey(SA_JSON);
    expect(c["client_email"]).toBe("x@y.iam.gserviceaccount.com");
  });

  it("parses base64-encoded JSON", () => {
    const b64 = Buffer.from(SA_JSON, "utf8").toString("base64");
    const c = parseServiceAccountKey(b64);
    expect(c["type"]).toBe("service_account");
  });

  it("tolerates surrounding whitespace on raw JSON", () => {
    const c = parseServiceAccountKey(`  \n${SA_JSON}\n `);
    expect(c["type"]).toBe("service_account");
  });

  it("throws on a value that is neither JSON nor base64 JSON", () => {
    expect(() => parseServiceAccountKey("this is not a key")).toThrow();
  });
});

describe("loadBackupConfig", () => {
  it("returns null when GDRIVE_SA_KEY is missing", () => {
    expect(loadBackupConfig({ GDRIVE_FOLDER_ID: "folder123" })).toBeNull();
  });

  it("returns null when GDRIVE_FOLDER_ID is missing", () => {
    expect(loadBackupConfig({ GDRIVE_SA_KEY: SA_JSON })).toBeNull();
  });

  it("returns null when a var is present but empty", () => {
    expect(loadBackupConfig({ GDRIVE_SA_KEY: SA_JSON, GDRIVE_FOLDER_ID: "" })).toBeNull();
  });

  it("returns config when both vars are present (raw JSON key)", () => {
    const cfg = loadBackupConfig({ GDRIVE_SA_KEY: SA_JSON, GDRIVE_FOLDER_ID: "folder123" });
    expect(cfg).not.toBeNull();
    expect(cfg?.folderId).toBe("folder123");
    expect(cfg?.credentials["client_email"]).toBe("x@y.iam.gserviceaccount.com");
  });

  it("accepts a base64-encoded key", () => {
    const b64 = Buffer.from(SA_JSON, "utf8").toString("base64");
    const cfg = loadBackupConfig({ GDRIVE_SA_KEY: b64, GDRIVE_FOLDER_ID: "folder123" });
    expect(cfg?.credentials["type"]).toBe("service_account");
  });

  it("throws when both vars are present but the key is malformed", () => {
    expect(() =>
      loadBackupConfig({ GDRIVE_SA_KEY: "garbage-not-a-key", GDRIVE_FOLDER_ID: "folder123" }),
    ).toThrow();
  });
});

describe("splitObjectPath", () => {
  it("splits a nested path into dirs + filename", () => {
    expect(splitObjectPath("proj1/wp1/a.jpg")).toEqual({ dirs: ["proj1", "wp1"], filename: "a.jpg" });
  });

  it("returns an empty dirs array for a root-level object", () => {
    expect(splitObjectPath("report.pdf")).toEqual({ dirs: [], filename: "report.pdf" });
  });
});

describe("decideAction", () => {
  const obj: RemoteObject = { path: "a.jpg", size: 100 };

  it("creates when the file is absent in Drive", () => {
    expect(decideAction(undefined, obj)).toBe("create");
  });

  it("updates when the sizes differ", () => {
    const existing: DriveFile = { id: "f1", name: "a.jpg", size: 50 };
    expect(decideAction(existing, obj)).toBe("update");
  });

  it("skips when path + size match", () => {
    const existing: DriveFile = { id: "f1", name: "a.jpg", size: 100 };
    expect(decideAction(existing, obj)).toBe("skip");
  });
});

describe("listBucketObjects", () => {
  it("paginates within a folder and recurses into subfolders", async () => {
    // Root: page1 = [x, y] (full page), page2 = [folder d]. d: page1 = [z].
    const pages: Record<string, RawStorageEntry[][]> = {
      "": [
        [
          { name: "x", isFolder: false, size: 1 },
          { name: "y", isFolder: false, size: 2 },
        ],
        [{ name: "d", isFolder: true, size: 0 }],
      ],
      d: [[{ name: "z", isFolder: false, size: 3 }]],
    };
    const calls: Array<[string, number]> = [];
    const list = async (prefix: string, offset: number): Promise<RawStorageEntry[]> => {
      calls.push([prefix, offset]);
      const p = pages[prefix] ?? [];
      return p[offset / 2] ?? [];
    };

    const objs = await listBucketObjects(list, 2);

    expect(objs).toEqual([
      { path: "x", size: 1 },
      { path: "y", size: 2 },
      { path: "d/z", size: 3 },
    ]);
    // Root was paged twice (offset 0 full → offset 2), subfolder once.
    expect(calls).toContainEqual(["", 0]);
    expect(calls).toContainEqual(["", 2]);
    expect(calls).toContainEqual(["d", 0]);
  });
});

// --- in-memory Drive fake -------------------------------------------------

type Child = { kind: "folder" | "file"; id: string; size: number };

class FakeDrive {
  private seq = 0;
  readonly rootId: string;
  readonly folders = new Map<string, Map<string, Child>>();
  readonly created: Array<{ folderId: string; name: string; size: number }> = [];
  readonly updated: Array<{ fileId: string; size: number }> = [];
  lastRun: { timestamp: string; buckets: Record<string, unknown>; errors: string[] } | null = null;

  constructor(rootId: string) {
    this.rootId = rootId;
    this.folders.set(rootId, new Map());
  }

  private child(folderId: string): Map<string, Child> {
    let m = this.folders.get(folderId);
    if (!m) {
      m = new Map();
      this.folders.set(folderId, m);
    }
    return m;
  }

  seedFolder(parentId: string, name: string): string {
    const id = `d${(this.seq += 1)}`;
    this.child(parentId).set(name, { kind: "folder", id, size: 0 });
    this.folders.set(id, new Map());
    return id;
  }

  seedFile(folderId: string, name: string, size: number): string {
    const id = `f${(this.seq += 1)}`;
    this.child(folderId).set(name, { kind: "file", id, size });
    return id;
  }

  hasFile(folderId: string, name: string): boolean {
    return this.child(folderId).get(name)?.kind === "file";
  }

  backend(): DriveBackend {
    return {
      findFolder: async (parentId, name) => {
        const c = this.child(parentId).get(name);
        return c && c.kind === "folder" ? c.id : null;
      },
      createFolder: async (parentId, name) => this.seedFolder(parentId, name),
      listFiles: async (folderId) => {
        const out: DriveFile[] = [];
        for (const [name, c] of this.child(folderId)) {
          if (c.kind === "file") out.push({ id: c.id, name, size: c.size });
        }
        return out;
      },
      createFile: async (folderId, name, _ct, body) => {
        this.seedFile(folderId, name, body.length);
        this.created.push({ folderId, name, size: body.length });
        if (name === "last-run.json") this.lastRun = JSON.parse(body.toString("utf8"));
      },
      updateFile: async (fileId, _ct, body) => {
        this.updated.push({ fileId, size: body.length });
        for (const m of this.folders.values()) {
          for (const [name, c] of m) {
            if (c.id === fileId) {
              c.size = body.length;
              if (name === "last-run.json") this.lastRun = JSON.parse(body.toString("utf8"));
            }
          }
        }
      },
    };
  }
}

function fakeStorage(
  fixture: Record<string, RemoteObject[]>,
  failDownload = new Set<string>(),
): StorageBackend {
  return {
    listObjects: async (bucket) => fixture[bucket] ?? [],
    download: async (bucket, path) => {
      if (failDownload.has(`${bucket}/${path}`)) throw new Error("boom download");
      const obj = (fixture[bucket] ?? []).find((o) => o.path === path);
      return Buffer.alloc(obj?.size ?? 0);
    },
  };
}

describe("runBackup", () => {
  it("uploads missing objects, creating the bucket/path folder tree", async () => {
    const drive = new FakeDrive("ROOT");
    const storage = fakeStorage({ photos: [{ path: "proj1/wp1/a.jpg", size: 10 }] });

    const summary = await runBackup({
      storage,
      drive: drive.backend(),
      folderId: "ROOT",
      buckets: ["photos"],
      now: () => new Date("2026-07-09T00:30:00Z"),
      log: () => {},
    });

    // The object was uploaded once.
    expect(drive.created.some((c) => c.name === "a.jpg" && c.size === 10)).toBe(true);
    // Folder tree ROOT/photos/proj1/wp1 exists.
    const photos = await drive.backend().findFolder("ROOT", "photos");
    expect(photos).not.toBeNull();
    // Heartbeat written with the right counts.
    expect(summary.timestamp).toBe("2026-07-09T00:30:00.000Z");
    expect(summary.buckets["photos"]).toEqual({ files: 1, uploaded: 1, bytes: 10 });
    expect(drive.lastRun?.buckets["photos"]).toEqual({ files: 1, uploaded: 1, bytes: 10 });
  });

  it("skips objects already present with the same size", async () => {
    const drive = new FakeDrive("ROOT");
    const photos = drive.seedFolder("ROOT", "photos");
    const wp = drive.seedFolder(photos, "wp1");
    drive.seedFile(wp, "a.jpg", 10);
    const storage = fakeStorage({ photos: [{ path: "wp1/a.jpg", size: 10 }] });

    const summary = await runBackup({
      storage,
      drive: drive.backend(),
      folderId: "ROOT",
      buckets: ["photos"],
      log: () => {},
    });

    expect(drive.created.some((c) => c.name === "a.jpg")).toBe(false);
    expect(drive.updated.length).toBe(0);
    // `bytes` counts bytes transferred this run — a skip transfers nothing.
    expect(summary.buckets["photos"]).toEqual({ files: 1, uploaded: 0, bytes: 0 });
  });

  it("updates objects whose size differs (no new file created)", async () => {
    const drive = new FakeDrive("ROOT");
    const photos = drive.seedFolder("ROOT", "photos");
    const fileId = drive.seedFile(photos, "a.jpg", 5);
    const storage = fakeStorage({ photos: [{ path: "a.jpg", size: 10 }] });

    const summary = await runBackup({
      storage,
      drive: drive.backend(),
      folderId: "ROOT",
      buckets: ["photos"],
      log: () => {},
    });

    expect(drive.updated).toContainEqual({ fileId, size: 10 });
    expect(drive.created.some((c) => c.name === "a.jpg")).toBe(false);
    expect(summary.buckets["photos"]).toEqual({ files: 1, uploaded: 1, bytes: 10 });
  });

  it("never deletes a Drive object that is absent from storage", async () => {
    const drive = new FakeDrive("ROOT");
    const photos = drive.seedFolder("ROOT", "photos");
    drive.seedFile(photos, "ghost.jpg", 4);
    const storage = fakeStorage({ photos: [{ path: "a.jpg", size: 10 }] });

    await runBackup({
      storage,
      drive: drive.backend(),
      folderId: "ROOT",
      buckets: ["photos"],
      log: () => {},
    });

    // ghost.jpg still there — backup is add/update-only.
    expect(drive.hasFile(photos, "ghost.jpg")).toBe(true);
  });

  it("records a per-file error and continues with the next object", async () => {
    const drive = new FakeDrive("ROOT");
    const storage = fakeStorage(
      {
        photos: [
          { path: "a.jpg", size: 5 },
          { path: "b.jpg", size: 5 },
        ],
      },
      new Set(["photos/a.jpg"]),
    );

    const summary = await runBackup({
      storage,
      drive: drive.backend(),
      folderId: "ROOT",
      buckets: ["photos"],
      log: () => {},
    });

    expect(summary.errors.some((e) => e.includes("photos/a.jpg"))).toBe(true);
    // b.jpg still uploaded despite a.jpg failing.
    expect(drive.created.some((c) => c.name === "b.jpg")).toBe(true);
    expect(summary.buckets["photos"]).toEqual({ files: 2, uploaded: 1, bytes: 5 });
    // Heartbeat still written even though one file errored.
    expect(drive.lastRun?.errors.length).toBe(1);
  });

  it("mirrors multiple buckets and writes a single heartbeat", async () => {
    const drive = new FakeDrive("ROOT");
    const storage = fakeStorage({
      photos: [{ path: "a.jpg", size: 3 }],
      reports: [{ path: "p/r.pdf", size: 7 }],
    });

    const summary = await runBackup({
      storage,
      drive: drive.backend(),
      folderId: "ROOT",
      buckets: ["photos", "reports"],
      log: () => {},
    });

    expect(summary.buckets["photos"]).toEqual({ files: 1, uploaded: 1, bytes: 3 });
    expect(summary.buckets["reports"]).toEqual({ files: 1, uploaded: 1, bytes: 7 });
    // last-run.json created exactly once, at the root.
    expect(drive.created.filter((c) => c.name === "last-run.json").length).toBe(1);
    expect(drive.created.find((c) => c.name === "last-run.json")?.folderId).toBe("ROOT");
  });
});
