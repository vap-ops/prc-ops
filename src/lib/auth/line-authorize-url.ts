// Single source for LINE's authorize URL (ADR 0012 locked params).
// Used by /auth/line/start (browser flow, state in a cookie) and
// /auth/handoff/start (PWA device-code flow, state in login_handoffs).

const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";

export function buildLineAuthorizeUrl(args: {
  origin: string;
  state: string;
  channelId: string;
}): URL {
  const url = new URL(LINE_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.channelId);
  url.searchParams.set("redirect_uri", `${args.origin}/auth/line/callback`);
  url.searchParams.set("state", args.state);
  url.searchParams.set("scope", "openid profile");
  return url;
}
