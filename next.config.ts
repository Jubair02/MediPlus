import type { NextConfig } from "next";

// `standalone` emits a self-contained server for container hosts (Render, Docker).
// Vercel runs its own output tracing and its builder fails when standalone is set —
// it looks for `.next/next-server.js.nft.json`, which this mode relocates. Vercel
// sets VERCEL=1 during the build, so key off that and leave its default output alone.
const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
