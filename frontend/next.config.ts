import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  // Produce a minimal Node.js server in .next/standalone — used by the
  // all-in-one Docker image and the individual frontend/Dockerfile.
  output: "standalone",
  // Allow requests from 127.0.0.1 in dev (needed because the Pinniped Supervisor
  // OIDCClient only accepts http://127.0.0.1:3000 as a redirect URI, not localhost).
  allowedDevOrigins: ["127.0.0.1"],
  /**
   * Proxy /auth/* and /api/v1/* to the Go backend.
   * This means:
   * - The browser only ever talks to localhost:3000
   * - Session cookies are scoped to localhost:3000
   * - No OIDC secrets are ever needed in the frontend
   */
  async rewrites() {
    return [
      {
        source: "/auth/:path*",
        destination: `${BACKEND_URL}/auth/:path*`,
      },
      {
        source: "/api/v1/:path*",
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
