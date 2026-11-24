import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Kamera behövs för dagsavslut (Etapp 5), plats för bollplockarnas GPS (egen branch).
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
];

const nextConfig: NextConfig = {
  // Medvetet AV: all personal-, schema- och lönedata är per användare och måste alltid
  // vara färsk. Alla sidor renderas dynamiskt vid varje anrop. Se docs/ARCHITECTURE.md.
  cacheComponents: false,
  // Pakets med inbyggda binärer ska inte buntas av Turbopack.
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  poweredByHeader: false,
  // Dagsavslut skickar en bild (högst 10 MB) via en Server Action. Standardgränsen är 1 MB.
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
