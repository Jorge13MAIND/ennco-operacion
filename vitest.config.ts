import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      // fileURLToPath, no .pathname: una ruta con espacios o caracteres fuera
      // de ASCII queda URL-codificada y el alias apunta a una carpeta inexistente.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
