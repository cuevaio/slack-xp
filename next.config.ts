import type { NextConfig } from "next";
import { assertProductionSafety } from "./src/lib/config";

assertProductionSafety(process.env);

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR,
  reactStrictMode: true,
};

export default nextConfig;
