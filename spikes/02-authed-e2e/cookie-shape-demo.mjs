// Spike 02 — cred-free proof of the @supabase/ssr 0.10.2 cookie SHAPE.
//
// Needs NO Supabase project. It runs a representative session object through
// the library's OWN encode functions (the same ones createServerClient uses
// internally) so the documented shape is observed, not recalled.
//
//   node spikes/02-authed-e2e/cookie-shape-demo.mjs
//
// Verifies, against @supabase/ssr@0.10.2 on disk:
//   - cookie NAME   = `sb-<projectRef>-auth-token`, ref = url host's 1st label
//   - cookie VALUE  = "base64-" + base64url(JSON.stringify(session))
//   - CHUNKING      = split into `.0`, `.1`, … when encoded length > 3180

import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { createChunks, MAX_CHUNK_SIZE } from "@supabase/ssr/dist/main/utils/chunker.js";

const BASE64_PREFIX = "base64-";

// cookie name, exactly as supabase-js SupabaseClient.ts:295 derives it.
function cookieName(url) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

// value encoding, exactly as @supabase/ssr cookies.js does for the default
// cookieEncoding "base64url".
function encodeSession(session) {
  return BASE64_PREFIX + stringToBase64URL(JSON.stringify(session));
}

function report(label, url, session) {
  const name = cookieName(url);
  const value = encodeSession(session);
  const chunks = createChunks(name, value);
  console.log(`\n=== ${label} ===`);
  console.log(`url                : ${url}`);
  console.log(`cookie name        : ${name}`);
  console.log(`raw JSON bytes     : ${JSON.stringify(session).length}`);
  console.log(`encoded length     : ${value.length}  (MAX_CHUNK_SIZE=${MAX_CHUNK_SIZE})`);
  console.log(`value prefix       : ${value.slice(0, 24)}…`);
  console.log(`chunk count        : ${chunks.length}`);
  console.log(`chunk cookie names : ${chunks.map((c) => c.name).join(", ")}`);
}

// A small session (short ES256 token, lean user) -> single cookie.
const small = {
  access_token: "eyJ" + "a".repeat(640),
  refresh_token: "r".repeat(40),
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  user: { id: "00000000-0000-0000-0000-000000000000", role: "authenticated" },
};

// A fat session (long token + heavy user_metadata) -> chunked .0/.1.
const large = {
  ...small,
  access_token: "eyJ" + "a".repeat(2600),
  user: {
    ...small.user,
    user_metadata: { provider: "e2e-spike", blob: "x".repeat(1200) },
  },
};

console.log("@supabase/ssr 0.10.2 — observed cookie shape (no Supabase project needed)");
report("small session", "https://abcdefghijklmnop.supabase.co", small);
report("large session", "https://abcdefghijklmnop.supabase.co", large);
