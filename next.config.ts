import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "postgres", "pino"],
  experimental: {
    // Audio blobs and speech uploads travel through server actions.
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [
      {
        /*
         * The worker must be revalidated on every load. A cached service
         * worker is a version of the app that cannot be updated — the one
         * caching mistake that is genuinely hard to recover from on a phone
         * you do not have in your hand.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/icons/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
