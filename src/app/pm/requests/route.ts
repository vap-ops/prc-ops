import { NextResponse, type NextRequest } from "next/server";

// Spec 19 §4: the PM purchase-decision queue merged into /requests —
// one purchasing surface for every role. A route handler (not a page)
// so the 308 is a REAL HTTP redirect: a page-level permanentRedirect
// would stream as a 200 under /pm's loading.tsx Suspense boundary.
// Bookmarks and LINE links carry over; the proxy still gates
// unauthenticated access on the target.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/requests", request.url), 308);
}
