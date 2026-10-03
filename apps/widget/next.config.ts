import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@helpflow/types", "@helpflow/config"],
};

export default nextConfig;
