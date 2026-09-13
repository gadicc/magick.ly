import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LegacyImportCommandError,
  type LegacyImportCommandOptions,
  runLegacyImportCommand,
} from "../src/migration/legacyImportCommand";

const usage = `Usage: pnpm migration:legacy <prepare|inspect|apply>
  --review /absolute/review.json --review-sha256 <sha256>
  --run /private/directory/run.json --neon-cli /absolute/neon --profile <name>

Run from the project root. Environment loading is supplied by Loom.
The review is an independently approved private artifact; no target, catalog,
backup or checkpoint is selected automatically. This command does not run
migrations or authorize a production cutover. Never put a database URL in argv.`;

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log(usage);
    return;
  }
  try {
    const [action, ...arguments_] = process.argv.slice(2);
    const expected = [
      "--review",
      "--review-sha256",
      "--run",
      "--neon-cli",
      "--profile",
    ];
    const flags = new Map<string, string>();
    if (arguments_.length !== expected.length * 2)
      throw new LegacyImportCommandError("INVALID_INPUT");
    for (let i = 0; i < arguments_.length; i += 2) {
      const key = arguments_[i];
      if (!expected.includes(key) || flags.has(key))
        throw new LegacyImportCommandError("INVALID_INPUT");
      flags.set(key, arguments_[i + 1]);
    }
    // Capture once. A present invalid override is never replaced by a fallback.
    const selectedUrl =
      process.env.MIGRATION_DATABASE_URL_UNPOOLED ??
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      "";
    const script = await realpath(process.argv[1]);
    const projectRoot = dirname(dirname(script));
    if (
      script !== join(projectRoot, "scripts/legacy-import.ts") ||
      (await realpath(process.cwd())) !== projectRoot
    )
      throw new LegacyImportCommandError("INVALID_INPUT");
    const receipt = await runLegacyImportCommand({
      action: action as LegacyImportCommandOptions["action"],
      reviewPath: flags.get("--review")!,
      reviewSha256: flags.get("--review-sha256")!,
      runPath: flags.get("--run")!,
      neonCli: flags.get("--neon-cli")!,
      neonProfile: flags.get("--profile")!,
      projectRoot,
      selectedUrl,
    });
    console.log(JSON.stringify({ success: true, receipt }));
  } catch (error) {
    console.error(
      JSON.stringify({
        success: false,
        code:
          error instanceof LegacyImportCommandError
            ? error.code
            : "IMPORT_FAILED",
        ...(error instanceof LegacyImportCommandError &&
        error.receipt !== undefined
          ? { receipt: error.receipt }
          : {}),
      }),
    );
    process.exitCode = 1;
  }
}
void main();
