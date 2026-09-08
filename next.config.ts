import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Los archivos de data/ se leen en tiempo de ejecucion con rutas construidas
  // (process.cwd() + string), que el trazado de Next no puede seguir, asi que
  // no viajaban al paquete serverless. Se incluyen explicitamente.
  outputFileTracingIncludes: {
    "/operacion/correos": ["./data/campaigns/**"],
    "/operacion": ["./data/campaigns/**"],
    "/api/v1/operations/correos/campaigns": ["./data/campaigns/**"],
  },
  experimental: {
    // Cache de cliente del App Router: un segmento visitado o precargado se
    // reusa sin ir al servidor. Sin esto, cada click en el panel vuelve a
    // ejecutar el snapshot completo (decenas de consultas) aunque el operador
    // haya estado ahi hace cinco segundos. dynamic cubre navegaciones ya
    // visitadas; static cubre lo que precargan los links con prefetch.
    staleTimes: {
      dynamic: 30,
      static: 60,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "X-XSS-Protection", value: "0" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      ...["/api/:path*", "/ingreso/:path*", "/operacion/:path*"].map((source) => ({
        source,
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      })),
    ];
  },
};

export default nextConfig;
