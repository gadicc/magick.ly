import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Expand this list as domain logic is extracted from UI and persistence.
      include: [
        "src/doc/prepare.js",
        "src/doc/shortcuts.ts",
        "src/study/scheduling.ts",
        "src/app/geomancy/tetragrams.ts",
        "src/app/chat/train/access.ts",
        "src/app/chat/train/ingestPdf.ts",
        "src/app/chat/train/upload/route.ts",
      ],
      thresholds: {
        perFile: true,
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
