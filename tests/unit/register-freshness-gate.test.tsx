// Writing failing test first.
//
// Spec 339 U2 — unapproved users are force-refreshed onto the current build.
//
// U1 gave /settings an HONEST "is this device stale?" line but left the fix to
// the user (read the cold-restart card, flick the app away). Unapproved
// applicants sitting on /register/* or /coming-soon are the population that most
// needs the current bundle — the spec-343 cliff fix only reaches them if their
// PWA is actually executing it — and they are the safest to reload: nobody's
// half-typed work is worth protecting on a screen whose whole job is "come back
// once you're set up". So on those routes only, a resumed stale bundle reloads
// itself.
//
// The decision is a pure function (`shouldReload`) so every branch is pinned
// without DOM/fetch mocking; the component wires the four live inputs
// (client bundle version, /api/health's deployed version, the sessionStorage
// loop-guard, and "is the user mid-typing") around it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { shouldReload } from "@/components/features/chrome/register-freshness-gate";

// ── the pure decision ──────────────────────────────────────────────────────
describe("shouldReload — spec 339 U2 decision core", () => {
  const fresh = {
    clientVersion: "0.172.0",
    deployedVersion: "0.173.0",
    alreadyReloadedFor: null,
    isTyping: false,
  };

  it("reloads when the client bundle is behind the deployed build", () => {
    expect(shouldReload(fresh)).toBe(true);
  });

  it("does NOT reload when the client version is unknown (dev/test, unset)", () => {
    expect(shouldReload({ ...fresh, clientVersion: null })).toBe(false);
  });

  it("does NOT reload when the deployed version is unknown (probe failed / offline)", () => {
    expect(shouldReload({ ...fresh, deployedVersion: null })).toBe(false);
  });

  it("does NOT reload when the bundle already matches the deployed build", () => {
    expect(shouldReload({ ...fresh, clientVersion: "0.173.0" })).toBe(false);
  });

  it("ignores the Vercel commit suffix on the client version when comparing", () => {
    expect(shouldReload({ ...fresh, clientVersion: "0.173.0+7f3a1c2" })).toBe(false);
  });

  it("does NOT reload while the user is mid-typing", () => {
    expect(shouldReload({ ...fresh, isTyping: true })).toBe(false);
  });

  it("does NOT reload twice for the same deployed version (loop-guard)", () => {
    expect(shouldReload({ ...fresh, alreadyReloadedFor: "0.173.0" })).toBe(false);
  });

  it("DOES reload when a NEWER deploy arrives after an earlier reload", () => {
    // guard is keyed to the version we last reloaded for, not "have we ever reloaded"
    expect(shouldReload({ ...fresh, alreadyReloadedFor: "0.171.0" })).toBe(true);
  });
});

// ── the wired island ───────────────────────────────────────────────────────
const RELOAD_KEY = "app-freshness-reloaded-for";

const reloadMock = vi.fn();
const fetchMock = vi.fn();
const realSessionStorage = window.sessionStorage;

// jsdom's sessionStorage is proxy-backed, so vi.spyOn on its methods does not
// take — swap the whole object to simulate storage that throws.
function useSessionStorage(fake: Partial<Storage>) {
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: fake });
}

function stubHealth(version: string | null, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    json: async () => (version === null ? {} : { version }),
  });
}

async function loadGate(clientVersion: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_VERSION", clientVersion);
  return (await import("@/components/features/chrome/register-freshness-gate"))
    .RegisterFreshnessGate;
}

beforeEach(() => {
  reloadMock.mockReset();
  fetchMock.mockReset();
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { reload: reloadMock },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: realSessionStorage,
  });
  vi.resetModules();
  document.body.innerHTML = "";
});

describe("RegisterFreshnessGate — spec 339 U2 wiring", () => {
  it("reloads a stale bundle on mount and stamps the loop-guard", async () => {
    stubHealth("0.173.0");
    const Gate = await loadGate("0.172.0");
    render(<Gate />);
    await vi.waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe("0.173.0");
  });

  it("does not reload when the bundle is already current", async () => {
    stubHealth("0.173.0");
    const Gate = await loadGate("0.173.0");
    render(<Gate />);
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("never fetches or reloads when the client version is unknown", async () => {
    stubHealth("0.173.0");
    const Gate = await loadGate("");
    render(<Gate />);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("respects the loop-guard already set for this deployed version", async () => {
    window.sessionStorage.setItem(RELOAD_KEY, "0.173.0");
    stubHealth("0.173.0");
    const Gate = await loadGate("0.172.0");
    render(<Gate />);
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does not reload while an input is focused (mid-typing)", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    stubHealth("0.173.0");
    const Gate = await loadGate("0.172.0");
    render(<Gate />);
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("re-checks on visibilitychange→visible (resume from background)", async () => {
    stubHealth("0.173.0");
    const Gate = await loadGate("0.173.0");
    render(<Gate />);
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadMock).not.toHaveBeenCalled(); // fresh on mount

    stubHealth("0.174.0"); // a new build deployed while backgrounded
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(RELOAD_KEY)).toBe("0.174.0");
  });

  // Storage can throw (private mode, storage disabled, quota). The guard MUST be
  // durably persisted before a reload — a reload whose guard did not stick would
  // re-mount, re-read nothing, and reload again (an infinite loop).
  it("does not reload when the loop-guard cannot be persisted (storage disabled)", async () => {
    useSessionStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("storage disabled");
      },
    });
    stubHealth("0.173.0");
    const Gate = await loadGate("0.172.0");
    render(<Gate />);
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("treats a throwing sessionStorage.getItem as no guard and still reloads a stale bundle", async () => {
    useSessionStorage({
      getItem: () => {
        throw new Error("read denied");
      },
      setItem: () => {}, // set succeeds, so the guard sticks and the reload proceeds
    });
    stubHealth("0.173.0");
    const Gate = await loadGate("0.172.0");
    render(<Gate />);
    await vi.waitFor(() => expect(reloadMock).toHaveBeenCalledTimes(1));
  });
});
