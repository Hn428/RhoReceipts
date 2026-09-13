import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  /**
   * Database drivers touch the filesystem directly (PGlite opens a data
   * directory; postgres.js opens sockets). Bundling them rewrites the module
   * graph enough to break Node's `fs` path handling, so they are loaded as
   * plain Node modules at runtime instead.
   */
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
