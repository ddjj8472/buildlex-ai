import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The corpus is read with fs at runtime; make sure it ships with the functions.
  outputFileTracingIncludes: {
    "/api/**": ["./data/index/**", "./data/knowledge/**"],
  },
};

export default nextConfig;
