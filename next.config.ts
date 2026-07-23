import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR,
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
