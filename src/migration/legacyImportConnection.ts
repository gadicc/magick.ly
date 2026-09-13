import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";

/** Credential-free transport selection; provider branch authority is checked separately. */
export interface LegacyImportConnectionTarget {
  host: string;
  port: 5432;
  database: string;
  role: string;
}
export class LegacyImportConnectionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CONNECTION"
      | "UNSUPPORTED_CHANNEL_BINDING"
      | "CONNECTION_CLOSE_FAILED",
  ) {
    super(code);
    this.name = "LegacyImportConnectionError";
  }
}
function fail(
  code: LegacyImportConnectionError["code"] = "INVALID_CONNECTION",
): never {
  throw new LegacyImportConnectionError(code);
}
function name(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.isWellFormed() &&
    !value.includes("\0") &&
    Buffer.byteLength(value) <= 63
  );
}

/**
 * Create a lazy, dedicated maintenance client from one captured direct URL.
 * This does not authenticate Neon project/branch mapping, approve a target or
 * verify its schema. The launcher must establish those gates before SQL use.
 * Never log the returned client/options or raw query errors: they hold secrets.
 * Unlike the runtime singleton, routing and TLS cannot fall back to ambient PG*.
 * The caller must close this client in finally, preserving any prior work error.
 */
export function createLegacyImportConnection(
  selectedUrl: string,
  expected: LegacyImportConnectionTarget,
) {
  let target: LegacyImportConnectionTarget, password: string;
  try {
    target = parseLegacyImportValue(
      serializeLegacyImportValue(expected),
    ) as LegacyImportConnectionTarget;
    if (
      !target ||
      typeof target !== "object" ||
      Object.getPrototypeOf(target) !== Object.prototype ||
      Object.keys(target).length !== 4 ||
      ["host", "port", "database", "role"].some(
        (key) => !Object.hasOwn(target, key),
      ) ||
      typeof target.host !== "string" ||
      target.host.length > 253 ||
      !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(target.host) ||
      target.host
        .split(".")
        .some((label) => label.length > 63 || /^-|-$/.test(label)) ||
      target.host.split(".")[0].endsWith("-pooler") ||
      target.port !== 5432 ||
      !name(target.database) ||
      !name(target.role) ||
      typeof selectedUrl !== "string" ||
      !selectedUrl.isWellFormed() ||
      selectedUrl.length > 16_384 ||
      /[\s\u0000-\u001f\u007f#]/u.test(selectedUrl)
    )
      fail();
    const url = new URL(selectedUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== target.host ||
      (url.port !== "" && url.port !== "5432") ||
      !url.pathname.startsWith("/") ||
      url.pathname.slice(1).includes("/") ||
      decodeURIComponent(url.pathname.slice(1)) !== target.database ||
      decodeURIComponent(url.username) !== target.role
    )
      fail();
    password = decodeURIComponent(url.password);
    if (!password.length || password.includes("\0")) fail();
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams) {
      if (seen.has(key)) fail();
      seen.add(key);
      // postgres.js currently offers SCRAM-SHA-256, not its PLUS mechanism.
      // Refuse an explicit channel-binding requirement rather than dropping it.
      if (key === "channel_binding" && value === "require")
        fail("UNSUPPORTED_CHANNEL_BINDING");
      if (key !== "sslmode" || !["require", "verify-full"].includes(value))
        fail();
    }
  } catch (error) {
    if (error instanceof LegacyImportConnectionError)
      throw new LegacyImportConnectionError(error.code);
    return fail();
  }
  try {
    // Pass fields rather than a URL: no query options become startup parameters.
    // All driver defaults with PG* fallbacks are explicit, including debug/type
    // discovery and connection lifetime. The selected password is nonempty.
    // postgres.js 3.4.9 implements these fields but omits them from its types.
    const options: postgres.Options<{}> & {
      sslnegotiation: "postgres";
      max_pipeline: 1;
    } = {
      host: target.host,
      port: target.port,
      database: target.database,
      username: target.role,
      password,
      ssl: { rejectUnauthorized: true },
      sslnegotiation: "postgres",
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      max_lifetime: 60,
      max_pipeline: 1,
      backoff: false,
      keep_alive: 0,
      prepare: false,
      debug: false,
      fetch_types: false,
      publications: "alltables",
      target_session_attrs: "read-write",
      connection: { application_name: "magickli-legacy-import-v1" },
      onnotice: () => {},
    };
    const client = postgres(options);
    return {
      db: drizzle(client),
      async close(): Promise<void> {
        try {
          await client.end({ timeout: 5 });
        } catch {
          fail("CONNECTION_CLOSE_FAILED");
        }
      },
    };
  } catch {
    return fail();
  }
}
