import type { NextConfig } from "next";
import { assertProductionSafety } from "./src/lib/config";

assertProductionSafety(process.env);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
