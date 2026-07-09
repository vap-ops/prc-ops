// Spec 241 — guards the PWA static-asset runtime cache policy in `public/sw.js`.
//
// Loads the REAL shipped service worker and runs its fetch / activate handlers in a
// mock ServiceWorker scope. The single safety-critical invariant: ONLY same-origin
// GET `/_next/static/*` requests are cache-first; EVERYTHING else (RSC, /api, /auth,
// POST Server Actions, cross-origin Supabase) passes straight to the network and is
// never cached. That allowlist is the entire PDPA boundary — no per-user/RLS data
// may ever land in the SW cache.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SW_SRC = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://app.test";

interface FakeRequest {
  url: string;
  method: string;
}
interface FetchEvent {
  request: FakeRequest;
  respondWith(p: Promise<unknown>): void;
}
interface ExtendableEvent {
  waitUntil(p: Promise<unknown>): void;
}
type Listener = (event: unknown) => void;

interface CachedResponse {
  ok: boolean;
  status?: number;
  clone(): CachedResponse;
}

function bootSw(existingCaches: string[] = ["prc-static-v0-stale", "prc-static-v1", "unrelated"]) {
  const listeners: Record<string, Listener> = {};
  const put = vi.fn<(req: unknown, res: unknown) => void>();
  const match = vi.fn<(req: unknown) => Promise<CachedResponse | undefined>>(async () => undefined);
  const open = vi.fn(async () => ({ match, put }));
  const del = vi.fn(async () => true);
  const keys = vi.fn(async () => existingCaches);
  const caches = { open, keys, delete: del, match: vi.fn() };
  const networkResponse: CachedResponse = { ok: true, status: 200, clone: () => networkResponse };
  const fetchMock = vi.fn(async (_input?: unknown, _init?: unknown) => networkResponse);
  const self = {
    addEventListener: (type: string, cb: Listener) => {
      listeners[type] = cb;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: ORIGIN },
    caches,
  };
  // Execute the SW source with its globals injected as params (they shadow the real
  // globals), so the test exercises the actual shipped file rather than a copy.
  new Function("self", "caches", "fetch", SW_SRC)(self, caches, fetchMock);
  return { listeners, open, match, put, del, keys, fetchMock };
}

function fire(sw: ReturnType<typeof bootSw>, url: string, method = "GET") {
  let responded: Promise<unknown> | undefined;
  const event: FetchEvent = {
    request: { url, method },
    respondWith: (p) => {
      responded = p;
    },
  };
  (sw.listeners.fetch as (e: FetchEvent) => void)(event);
  return responded ?? Promise.resolve();
}

describe("sw.js static-asset cache policy (spec 241)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cache-first for same-origin GET /_next/static — opens cache, populates on miss", async () => {
    const sw = bootSw();
    await fire(sw, `${ORIGIN}/_next/static/chunks/abc123.js`);
    expect(sw.open).toHaveBeenCalled();
    expect(sw.match).toHaveBeenCalled();
    expect(sw.fetchMock).toHaveBeenCalled(); // miss → network
    expect(sw.put).toHaveBeenCalled(); // populate
  });

  it("serves a cache hit without touching the network", async () => {
    const sw = bootSw();
    sw.match.mockResolvedValueOnce({ ok: true, clone: () => ({ ok: true }) as CachedResponse });
    await fire(sw, `${ORIGIN}/_next/static/chunks/hit.js`);
    expect(sw.match).toHaveBeenCalled();
    expect(sw.fetchMock).not.toHaveBeenCalled();
    expect(sw.put).not.toHaveBeenCalled();
  });

  it("RSC navigation request (?_rsc) bypasses the cache → network only", async () => {
    const sw = bootSw();
    await fire(sw, `${ORIGIN}/dashboard?_rsc=1a2b3`);
    expect(sw.open).not.toHaveBeenCalled();
    expect(sw.fetchMock).toHaveBeenCalled();
  });

  it("/api request bypasses the cache", async () => {
    const sw = bootSw();
    await fire(sw, `${ORIGIN}/api/notifications/drain`);
    expect(sw.open).not.toHaveBeenCalled();
    expect(sw.fetchMock).toHaveBeenCalled();
  });

  it("/auth request bypasses the cache", async () => {
    const sw = bootSw();
    await fire(sw, `${ORIGIN}/auth/line/callback`);
    expect(sw.open).not.toHaveBeenCalled();
  });

  it("Server Action POST bypasses the cache", async () => {
    const sw = bootSw();
    await fire(sw, `${ORIGIN}/requests`, "POST");
    expect(sw.open).not.toHaveBeenCalled();
    expect(sw.fetchMock).toHaveBeenCalled();
  });

  it("cross-origin (Supabase) GET bypasses the cache", async () => {
    const sw = bootSw();
    await fire(sw, "https://btbfzhnvzruvxlgbeqnl.supabase.co/storage/v1/object/sign/x.jpg");
    expect(sw.open).not.toHaveBeenCalled();
    expect(sw.fetchMock).toHaveBeenCalled();
  });

  it("a same-origin dynamic GET (a page document) is not cached", async () => {
    const sw = bootSw();
    await fire(sw, `${ORIGIN}/projects/abc/work-packages/def`);
    expect(sw.open).not.toHaveBeenCalled();
  });

  it("activate prunes every cache except the current version", async () => {
    const sw = bootSw(["prc-static-v0-stale", "prc-static-v1", "unrelated"]);
    let done: Promise<unknown> | undefined;
    const event: ExtendableEvent = {
      waitUntil: (p) => {
        done = p;
      },
    };
    (sw.listeners.activate as (e: ExtendableEvent) => void)(event);
    await (done ?? Promise.resolve());
    expect(sw.del).toHaveBeenCalledWith("prc-static-v0-stale");
    expect(sw.del).toHaveBeenCalledWith("unrelated");
    expect(sw.del).not.toHaveBeenCalledWith("prc-static-v1");
  });
});

// ---- Spec 290 — warm the static cache from the build's precache manifest ----

interface MessageEvent {
  data: unknown;
  waitUntil(p: Promise<unknown>): void;
}

/** Point the fetch mock at a manifest + 200 assets. Returns the list of fetched URLs. */
function stubManifestFetch(
  sw: ReturnType<typeof bootSw>,
  manifestBody: unknown,
  opts: { manifestStatus?: number; reject?: boolean } = {},
) {
  const fetched: string[] = [];
  sw.fetchMock.mockImplementation(async (input: unknown) => {
    const url =
      typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    fetched.push(url);
    if (url.endsWith("/precache-manifest.json")) {
      if (opts.reject) throw new Error("network down");
      return {
        ok: (opts.manifestStatus ?? 200) === 200,
        status: opts.manifestStatus ?? 200,
        json: async () => manifestBody,
        clone: () => ({ ok: true }) as CachedResponse,
      } as never;
    }
    const res: CachedResponse = { ok: true, status: 200, clone: () => res };
    return res as never;
  });
  return fetched;
}

function fireWarm(sw: ReturnType<typeof bootSw>) {
  let done: Promise<unknown> | undefined;
  const event: MessageEvent = {
    data: { type: "WARM_STATIC_CACHE" },
    waitUntil: (p) => {
      done = p;
    },
  };
  (sw.listeners.message as (e: MessageEvent) => void)(event);
  return done ?? Promise.resolve();
}

describe("sw.js precache warm (spec 290)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("WARM_STATIC_CACHE message fetches the manifest and caches missing static assets", async () => {
    const sw = bootSw();
    const fetched = stubManifestFetch(sw, {
      assets: ["/_next/static/chunks/a.js", "/_next/static/css/b.css"],
    });
    await fireWarm(sw);
    expect(fetched[0]).toContain("/precache-manifest.json");
    expect(fetched).toContain(`${ORIGIN}/_next/static/chunks/a.js`);
    expect(fetched).toContain(`${ORIGIN}/_next/static/css/b.css`);
    expect(sw.put).toHaveBeenCalledTimes(2);
  });

  it("re-enforces the PDPA allowlist — non-/_next/static entries are NEVER fetched or cached", async () => {
    const sw = bootSw();
    const fetched = stubManifestFetch(sw, {
      assets: [
        "/api/health",
        "https://evil.example/x.js",
        "/dashboard",
        123,
        null,
        // path-traversal attempts: startsWith on the RAW string passes, but URL
        // normalization would resolve these OUTSIDE /_next/static/ — the guard
        // must gate on the RESOLVED pathname (reviewer-caught bypass).
        "/_next/static/../../api/secrets",
        "/_next/static/..\\..\\auth/line/callback",
        "/_next/static/chunks/ok.js",
      ],
    });
    await fireWarm(sw);
    const assetFetches = fetched.filter((u) => !u.endsWith("/precache-manifest.json"));
    expect(assetFetches).toEqual([`${ORIGIN}/_next/static/chunks/ok.js`]);
    expect(sw.put).toHaveBeenCalledTimes(1);
  });

  it("skips assets already in the cache", async () => {
    const sw = bootSw();
    sw.match.mockResolvedValue({ ok: true, clone: () => ({ ok: true }) as CachedResponse });
    const fetched = stubManifestFetch(sw, { assets: ["/_next/static/chunks/cached.js"] });
    await fireWarm(sw);
    expect(fetched.filter((u) => !u.endsWith("/precache-manifest.json"))).toEqual([]);
    expect(sw.put).not.toHaveBeenCalled();
  });

  it("is fail-open: a manifest fetch failure never throws and caches nothing", async () => {
    const sw = bootSw();
    stubManifestFetch(sw, null, { reject: true });
    await expect(fireWarm(sw)).resolves.toBeUndefined();
    expect(sw.put).not.toHaveBeenCalled();
  });

  it("is fail-open on a non-200 or malformed manifest", async () => {
    const sw = bootSw();
    stubManifestFetch(sw, { nope: true }, { manifestStatus: 503 });
    await fireWarm(sw);
    expect(sw.put).not.toHaveBeenCalled();
    vi.clearAllMocks();
    const sw2 = bootSw();
    stubManifestFetch(sw2, { assets: "not-an-array" });
    await fireWarm(sw2);
    expect(sw2.put).not.toHaveBeenCalled();
  });

  it("ignores unrelated message types", async () => {
    const sw = bootSw();
    const fetched = stubManifestFetch(sw, { assets: ["/_next/static/chunks/a.js"] });
    const event: MessageEvent = { data: { type: "OTHER" }, waitUntil: () => {} };
    (sw.listeners.message as (e: MessageEvent) => void)(event);
    await Promise.resolve();
    expect(fetched).toEqual([]);
  });

  it("activate also warms (covers SW-update deploys)", async () => {
    const sw = bootSw();
    const fetched = stubManifestFetch(sw, { assets: ["/_next/static/chunks/a.js"] });
    let done: Promise<unknown> | undefined;
    const event: ExtendableEvent = {
      waitUntil: (p) => {
        done = p;
      },
    };
    (sw.listeners.activate as (e: ExtendableEvent) => void)(event);
    await (done ?? Promise.resolve());
    expect(fetched.some((u) => u.endsWith("/precache-manifest.json"))).toBe(true);
    // prune behavior unchanged
    expect(sw.del).toHaveBeenCalledWith("prc-static-v0-stale");
  });
});
