import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // hookTimeout: el beforeAll levanta Postgres en proceso (PGlite), que en frío puede tardar.
  test: { environment: "node", include: ["tests/**/*.test.ts"], hookTimeout: 30_000 },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
});
