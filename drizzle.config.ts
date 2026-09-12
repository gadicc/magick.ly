import { createDrizzleConfig } from "@gadicc/loom/db/drizzle-config";

export default createDrizzleConfig({
  outDir: "./drizzle",
  schemaDir: "./src/db/schema",
});
