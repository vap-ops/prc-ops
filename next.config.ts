import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spec 39: pdfkit ships font/AFM data files it resolves from
  // node_modules at runtime — bundling breaks those reads.
  serverExternalPackages: ["pdfkit"],

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
      { source: "/sa", destination: "/projects", permanent: false },
      { source: "/pm/projects", destination: "/projects", permanent: false },
    ];
  },
};

export default nextConfig;
