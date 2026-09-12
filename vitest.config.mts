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
        "src/doc/access.ts",
        "src/doc/legacyAccess.ts",
        "src/doc/publications.ts",
        "src/study/scheduling.ts",
        "src/app/geomancy/tetragrams.ts",
        "src/app/chat/train/access.ts",
        "src/app/chat/train/ingestPdf.ts",
        "src/app/chat/train/upload/route.ts",
        "src/lib/ids.ts",
        "src/db/legacyIds.ts",
        "src/migration/normalizeLegacyAuth.ts",
        "src/schemas/templeMembership.ts",
        "src/app/chat/contracts.ts",
        "src/app/chat/conversation.ts",
        "src/app/chat/providers.ts",
        "src/app/chat/corpus.ts",
        "src/app/chat/mmr.ts",
        "src/app/chat/server.ts",
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
