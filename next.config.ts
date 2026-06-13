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
    ];
  },
};

export default nextConfig;
