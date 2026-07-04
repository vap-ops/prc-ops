// spec 263 follow-up — safeNextPath: the open-redirect guard for the
// login return-path (`?next`). ACCEPT only a relative same-origin path
// (single leading "/", no "//", no "\", no scheme, no "@"); everything
// else → null. Tested hard because a hole here is an open redirect on
// the auth surface.

import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";

describe("safeNextPath — accepts safe same-origin relative paths", () => {
  const accepted: Array<[string, string]> = [
    ["/register/technician", "/register/technician"],
    ["/", "/"],
    ["/requests", "/requests"],
    ["/register/technician?ref=qr", "/register/technician?ref=qr"],
    ["/projects/abc-123", "/projects/abc-123"],
    ["/a/b/c?x=1&y=2#frag", "/a/b/c?x=1&y=2#frag"],
  ];
  it.each(accepted)("accepts %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });
});

describe("safeNextPath — rejects everything unsafe → null", () => {
  const rejected: Array<[string, string | null | undefined]> = [
    ["protocol-relative //evil.com", "//evil.com"],
    ["backslash-smuggled protocol-relative", "/\\evil.com"],
    ["absolute https URL", "https://evil.com"],
    ["absolute http URL", "http://evil.com"],
    ["scheme-relative with path", "https://evil.com/register/technician"],
    ["javascript scheme", "javascript:alert(1)"],
    ["JavaScript scheme mixed case", "JavaScript:alert(1)"],
    ["data scheme", "data:text/html,x"],
    ["mailto scheme", "mailto:a@b.com"],
    ["userinfo @ smuggling", "/@evil.com"],
    ["userinfo @ mid-path", "/foo@evil.com"],
    ["bare backslash path", "\\evil.com"],
    ["backslash anywhere", "/foo\\bar"],
    ["relative without leading slash", "register/technician"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["leading-whitespace-then-scheme", "  https://evil.com"],
    ["null", null],
    ["undefined", undefined],
    ["control char newline", "/foo\nbar"],
    ["control char tab", "/foo\tbar"],
    ["encoded protocol-relative /%2Fevil", "/%2Fevil.com"],
  ];
  it.each(rejected)("rejects %s", (_label, raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });
});
