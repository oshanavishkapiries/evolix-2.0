import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Release tag on error events: the deployed commit.
const release = (() => {
  if (process.env.NEXT_PUBLIC_RELEASE) return process.env.NEXT_PUBLIC_RELEASE;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  env: { NEXT_PUBLIC_RELEASE: release },
  // Public files default to max-age=0; explicitly revalidate the worker on updates.
  headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
  // Source maps let the error tracker show original files and lines. Browser maps are read from disk by the
  // server and never served: proxy.ts answers 404 for *.map.
  productionBrowserSourceMaps: true,
  experimental: { serverSourceMaps: true },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
