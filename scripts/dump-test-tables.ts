import {
  defineFixtureTables,
  dumpFixtureTables,
} from "@gadicc/loom/db/fixtures";
import { db } from "../src/db/neon";
import * as tables from "../src/db/schema/index";

const tablesToProcess = defineFixtureTables<typeof tables>({
  // exampleTable: true,
});

await dumpFixtureTables({
  db,
  outputPath: "./tests/fixtures/db/",
  tables,
  tablesToProcess,
});
