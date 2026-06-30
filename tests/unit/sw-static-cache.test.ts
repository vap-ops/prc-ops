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
  const fetchMock = vi.fn(async () => networkResponse);
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
