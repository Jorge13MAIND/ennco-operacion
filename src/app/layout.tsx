import type { Metadata } from "next";

import "./globals.css";

import { getRuntimeConfig } from "@/lib/runtime/config";
import { PRIVATE_ROBOTS } from "@/lib/seo/indexing";

export function generateMetadata(): Metadata {
  const config = getRuntimeConfig();
  return {
    metadataBase: new URL(config.appUrl),
    title: "ENNCO | Sistema comercial",
    description: "Sistema operativo comercial de ENNCO.",
    robots: PRIVATE_ROBOTS,
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
