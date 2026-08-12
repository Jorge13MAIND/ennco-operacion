import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ENNCO | Sistema comercial",
  description: "Sistema operativo comercial de ENNCO.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
