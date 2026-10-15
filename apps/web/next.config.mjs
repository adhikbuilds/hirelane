const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; dev also needs eval for React refresh.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws://localhost:3001" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // The job page has a markdown twin chosen by Accept (middleware), so caches must key on it.
      { source: "/job/:slug", headers: [{ key: "Vary", value: "Accept" }] },
    ];
  },
};

export default nextConfig;
