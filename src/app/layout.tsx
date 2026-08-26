import type { Metadata } from "next";

import "@fontsource/aileron/latin-400.css";
import "@fontsource/aileron/latin-600.css";
import "@fontsource/aileron/latin-700.css";
import "@fontsource/aileron/latin-800.css";

import "./globals.css";

import { getRuntimeConfig } from "@/lib/runtime/config";
import { PRIVATE_ROBOTS } from "@/lib/seo/indexing";

export function generateMetadata(): Metadata {
  const config = getRuntimeConfig();
  return {
    metadataBase: new URL(config.appUrl),
    title: "ENNCO | Sistema comercial",
    description: "Sistema operativo comercial de ENNCO.",
    icons: {
      icon: "/brand/ennco-mark.svg",
      shortcut: "/brand/ennco-mark.svg",
    },
    robots: PRIVATE_ROBOTS,
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>
        <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
        {children}
      </body>
    </html>
  );
}
