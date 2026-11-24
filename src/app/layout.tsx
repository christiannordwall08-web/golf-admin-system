import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Golf Admin", template: "%s · Golf Admin" },
  description: "Administrationssystem för golfanläggningens personal, scheman, arbetstid och löneunderlag.",
  // Internt system: ska aldrig indexeras.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#235a3d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
