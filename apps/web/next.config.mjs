import { buildSecurityHeaders } from "./security-headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@hirelane/db", "@hirelane/engine"],
  serverExternalPackages: ["pg", "graphile-worker"],
  // Workspace packages are TypeScript sources that import siblings with NodeNext-style ".js" suffixes.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
      // The job page has a markdown twin chosen by Accept (middleware), so caches must key on it.
      { source: "/job/:slug", headers: [{ key: "Vary", value: "Accept" }] },
    ];
  },
};

export default nextConfig;
