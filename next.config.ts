import type { NextConfig } from "next";

// `standalone` emits a self-contained server for container hosts (Render, Docker).
// Vercel runs its own output tracing and its builder fails when standalone is set —
// it looks for `.next/next-server.js.nft.json`, which this mode relocates. Vercel
// sets VERCEL=1 during the build, so key off that and leave its default output alone.
const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  // No `typescript.ignoreBuildErrors` here on purpose: with it on, `next build` shipped
  // type errors silently and nothing static stood between a regression and production.
  // `examples/` and `download/` are excluded in tsconfig.json instead (they import
  // packages that are not installed), so the app's own code is the thing being checked.
  reactStrictMode: false,
};

export default nextConfig;
