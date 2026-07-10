// Spec 290 — SwRegister nudges the ready SW to warm the static cache, once per
// browser session. RED first: the component currently only registers.

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SwRegister } from "@/components/features/chrome/sw-register";

const postMessage = vi.fn();
const register = vi.fn(async () => ({}));

function stubServiceWorker() {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      register,
      ready: Promise.resolve({ active: { postMessage } }),
    },
  });
}

describe("SwRegister warm nudge (spec 290)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    stubServiceWorker();
    window.sessionStorage.clear();
    postMessage.mockClear();
    register.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers the SW and posts WARM_STATIC_CACHE to the ready worker", async () => {
    render(<SwRegister />);
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "WARM_STATIC_CACHE" }));
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("nudges at most once per browser session", async () => {
    render(<SwRegister />);
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    render(<SwRegister />);
    // allow any wrongly-scheduled second nudge to flush
    await new Promise((r) => setTimeout(r, 20));
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    render(<SwRegister />);
    await new Promise((r) => setTimeout(r, 20));
    expect(register).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
