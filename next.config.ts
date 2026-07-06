import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spec 39: pdfkit ships font/AFM data files it resolves from
  // node_modules at runtime — bundling breaks those reads.
  serverExternalPackages: ["pdfkit"],

  // Perf: re-enable the client Router Cache. Next 15 changed the default
  // staleTimes.dynamic to 0s, so EVERY back/repeat navigation re-fetches the
  // RSC payload from the server even within one session — a big part of the
  // "page loads feel sluggish" report on revisits. dynamic:30 serves a cached
  // tree for up to 30s on client nav (low staleness risk — mutations already
  // call router.refresh(), which invalidates this cache); static:180 caches
  // prefetched static segments (must be >= 30 per Next's constraint).
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },

  // Spec 82 Unit 1: the project detail surfaces moved out of the role-named
  // /sa namespace into the content-named /projects namespace (the URL names
  // what is shown, not the viewer's role). In-app links all point at the new
  // paths; this keeps external deep links (bookmarks) resolving. 307 (NOT a
  // permanent 308) on purpose during rollout — an installed PWA caches a
  // permanent redirect stickily; Unit 5 promotes it once links are migrated.
  async redirects() {
    return [
      {
        source: "/sa/projects/:path*",
        destination: "/projects/:path*",
        permanent: false,
      },
      // Unit 2: reports moved off /pm/projects/[id]/reports. Specific source
      // (not /pm/projects/:path*) so the /pm/projects hub itself is untouched.
      {
        source: "/pm/projects/:projectId/reports",
        destination: "/projects/:projectId/reports",
        permanent: false,
      },
      // Unit 3: the two project hubs folded into one /projects hub. Exact
      // sources — /sa/projects/* and /pm/projects/*/reports keep their own
      // (earlier, more specific) rules above.
      //
      // The bare `/sa` → `/projects` redirect was REMOVED 2026-07-07: spec 192
      // revived /sa as the site_admin DAILY HOME (roleHome(site_admin) === "/sa";
      // the spec-273 แผนพรุ่งนี้ board lives under it). The leftover spec-82 fold
      // had been 307'ing every /sa hit to /projects, so the SA home + board were
      // unreachable and the หน้าหลัก tab bounced to the project hub. Only the bare
      // /sa is gone; /sa/projects/* (legacy deep links) stays above.
      // Guard: tests/unit/next-config-redirects.test.ts.
      { source: "/pm/projects", destination: "/projects", permanent: false },
      // Unit 4: the remaining role-named surfaces move to content-named ones.
      // More-specific subtree sources first; the bare /pm exact is last (it
      // must NOT shadow /pm/projects above, /pm/work-packages, or the still-
      // live /pm/requests legacy redirect — exact /pm matches only /pm).
      {
        source: "/pm/work-packages/:path*",
        destination: "/review/work-packages/:path*",
        permanent: false,
      },
      { source: "/pm/payroll/:path*", destination: "/payroll/:path*", permanent: false },
      { source: "/pm/contacts", destination: "/contacts", permanent: false },
      { source: "/pm", destination: "/review", permanent: false },
    ];
  },
};

export default nextConfig;
