import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spec 39: pdfkit ships font/AFM data files it resolves from
  // node_modules at runtime — bundling breaks those reads.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
