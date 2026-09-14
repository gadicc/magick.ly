import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export const LOCAL_ACCEPTANCE_DATABASE = "magickli_acceptance_20260914";
export const LOCAL_ACCEPTANCE_ROLE = "magickli_acceptance_20260914";
export const LOCAL_ACCEPTANCE_ORIGIN = "http://127.0.0.1:3115";
export const LOCAL_ACCEPTANCE_OUTPUT =
  "output/playwright/local-acceptance/auth";

export interface LocalAcceptanceConfig {
  databaseUrl: string;
  authSecret: string;
  origin: string;
  outputDirectory: string;
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
) {
  const value = environment[name]?.trim();
  if (!value || value.includes("\0"))
    throw new Error("LOCAL_ACCEPTANCE_CONFIG_INVALID");
  return value;
}

function parseDatabaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LOCAL_ACCEPTANCE_TARGET_INVALID");
  }
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "5432" ||
    decodeURIComponent(url.username) !== LOCAL_ACCEPTANCE_ROLE ||
    decodeURIComponent(url.pathname.slice(1)) !== LOCAL_ACCEPTANCE_DATABASE ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error("LOCAL_ACCEPTANCE_TARGET_INVALID");
  return url;
}

export function readLocalAcceptanceConfig(
  environment: Readonly<Record<string, string | undefined>>,
  cwd = process.cwd(),
): LocalAcceptanceConfig {
  if (
    Object.entries(environment).some(
      ([name, value]) =>
        Boolean(value) && (name === "VERCEL" || name.startsWith("VERCEL_")),
    )
  )
    throw new Error("LOCAL_ACCEPTANCE_VERCEL_REFUSED");
  const databaseUrl = required(environment, "DATABASE_URL_UNPOOLED");
  const direct = parseDatabaseUrl(databaseUrl);
  for (const name of [
    "DATABASE_URL_DIRECT",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
  ]) {
    const value = environment[name]?.trim();
    if (!value) continue;
    const candidate = parseDatabaseUrl(value);
    if (
      decodeURIComponent(candidate.username) !==
        decodeURIComponent(direct.username) ||
      decodeURIComponent(candidate.password) !==
        decodeURIComponent(direct.password)
    )
      throw new Error("LOCAL_ACCEPTANCE_TARGET_INVALID");
  }
  const origin = required(environment, "BETTER_AUTH_URL");
  if (origin !== LOCAL_ACCEPTANCE_ORIGIN)
    throw new Error("LOCAL_ACCEPTANCE_ORIGIN_INVALID");
  const authSecret = required(environment, "BETTER_AUTH_SECRET");
  if (authSecret.length < 32)
    throw new Error("LOCAL_ACCEPTANCE_CONFIG_INVALID");
  const allowed = path.resolve(cwd, "output/playwright/local-acceptance");
  const outputDirectory = path.resolve(cwd, LOCAL_ACCEPTANCE_OUTPUT);
  const relative = path.relative(allowed, outputDirectory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("LOCAL_ACCEPTANCE_OUTPUT_INVALID");
  return {
    databaseUrl,
    authSecret,
    origin,
    outputDirectory,
  };
}

async function rejectSymlink(value: string) {
  try {
    if ((await lstat(value)).isSymbolicLink())
      throw new Error("LOCAL_ACCEPTANCE_OUTPUT_INVALID");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function prepareLocalAcceptanceOutput(
  config: LocalAcceptanceConfig,
  cwd = process.cwd(),
) {
  const allowed = path.resolve(cwd, "output/playwright/local-acceptance");
  await rejectSymlink(path.resolve(cwd, "output"));
  await rejectSymlink(path.resolve(cwd, "output/playwright"));
  await rejectSymlink(allowed);
  await rejectSymlink(config.outputDirectory);
  await mkdir(config.outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(config.outputDirectory, 0o700);
  const [canonicalAllowed, canonicalOutput] = await Promise.all([
    realpath(allowed),
    realpath(config.outputDirectory),
  ]);
  const relative = path.relative(canonicalAllowed, canonicalOutput);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("LOCAL_ACCEPTANCE_OUTPUT_INVALID");
  return canonicalOutput;
}
