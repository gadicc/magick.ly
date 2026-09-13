import { Socket } from "node:net";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(),
  drizzle: vi.fn(),
  end: vi.fn(),
}));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: mocks.drizzle }));

import {
  createLegacyImportConnection as create,
  LegacyImportConnectionError,
} from "./legacyImportConnection";

const host = "ep-synthetic-123.eu-west-2.aws.neon.tech";
const secret = "synthetic-password-ONLY-FOR-TEST";
const url = `postgresql://migration_owner:${secret}@${host}/neondb`;
const target = () => ({
  host,
  port: 5432 as const,
  database: "neondb",
  role: "migration_owner",
});
const client = { end: mocks.end };
const database = { synthetic: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.end.mockReset().mockResolvedValue(undefined);
  mocks.postgres.mockReset().mockReturnValue(client);
  mocks.drizzle.mockReset().mockReturnValue(database);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function safeError(caught: unknown, code: LegacyImportConnectionError["code"]) {
  expect(caught).toBeInstanceOf(LegacyImportConnectionError);
  expect((caught as Error).message).toBe(code);
  expect((caught as LegacyImportConnectionError).code).toBe(code);
  expect(Reflect.ownKeys(caught as object).sort()).toEqual([
    "code",
    "message",
    "name",
    "stack",
  ]);
  expect(JSON.stringify(caught)).not.toContain(secret);
}
function invalid(
  value: unknown,
  expected: unknown = target(),
  code: LegacyImportConnectionError["code"] = "INVALID_CONNECTION",
) {
  let caught: unknown;
  try {
    create(value as string, expected as ReturnType<typeof target>);
  } catch (error) {
    caught = error;
  }
  safeError(caught, code);
  expect(mocks.postgres).not.toHaveBeenCalled();
  expect(mocks.drizzle).not.toHaveBeenCalled();
}
function suppliedOptions() {
  const args = mocks.postgres.mock.calls.at(-1)!;
  expect(args).toHaveLength(1);
  expect(typeof args[0]).toBe("object");
  return args[0] as Record<string, unknown>;
}

describe("closed maintenance database connection", () => {
  it.each(["", "?sslmode=require", "?sslmode=verify-full"])(
    "constructs explicit verified options for %s without passing the raw URL",
    async (query) => {
      const connection = create(`${url}${query}`, target());
      expect(connection.db).toBe(database);
      expect(mocks.drizzle).toHaveBeenCalledWith(client);
      const options = suppliedOptions();
      expect(options).toMatchObject({
        host,
        port: 5432,
        database: "neondb",
        username: "migration_owner",
        password: secret,
        max: 1,
        prepare: false,
        debug: false,
      });
      expect(options.ssl).toMatchObject({ rejectUnauthorized: true });
      expect(options.connect_timeout).toBeGreaterThan(0);
      expect(options.connect_timeout).toBeLessThanOrEqual(10);
      expect(typeof options.onnotice).toBe("function");
      await connection.close();
      expect(mocks.end).toHaveBeenCalledTimes(1);
      expect(mocks.end.mock.calls[0][0].timeout).toBeGreaterThan(0);
      expect(mocks.end.mock.calls[0][0].timeout).toBeLessThanOrEqual(5);
    },
  );

  it("accepts the postgres scheme and explicit default port", async () => {
    const connection = create(
      url
        .replace("postgresql:", "postgres:")
        .replace(`${host}/`, `${host}:5432/`),
      target(),
    );
    expect(suppliedOptions()).toMatchObject({ host, port: 5432 });
    await connection.close();
  });

  it.each([
    ["migration owner", "database name", "a:b@c/%?#+ =密碼"],
    ["migración", "資料", "%20-is-literal"],
    ["role:/?@", "db#?/:.", "opaque:password"],
    ["role\towner", "db\rname", "opaque\npassword"],
  ])(
    "preserves exact escaped identifiers and credentials (%s)",
    async (role, databaseName, password) => {
      const expected = { ...target(), role, database: databaseName };
      const selected = `postgresql://${encodeURIComponent(role)}:${encodeURIComponent(password)}@${host}/${encodeURIComponent(databaseName)}`;
      const connection = create(selected, expected);
      expect(suppliedOptions()).toMatchObject({
        username: role,
        database: databaseName,
        password,
      });
      await connection.close();
    },
  );

  it.each(["disable", "prefer", "", "REQUIRE"])(
    "refuses unsupported channel_binding=%s",
    (value) => {
      invalid(`${url}?channel_binding=${value}`);
    },
  );

  it.each([
    ["overlong URL", url.replace(secret, "p".repeat(16_384))],
    ["invalid UTF-8 password", url.replace(secret, "%ff")],
    ["invalid UTF-8 role", url.replace("migration_owner", "%ff")],
    ["invalid UTF-8 database", url.replace("neondb", "%ff")],
    ["unpaired surrogate", url.replace(secret, "\ud800")],
    ["empty query key", `${url}?=require`],
    ["uppercase SSL key", `${url}?SSLMODE=require`],
    ["empty host label", url.replace(host, "ep-synthetic-123..neon.tech")],
    ["trailing host dot", url.replace(host, `${host}.`)],
  ])("rejects %s without invoking the driver", (_name, selected) =>
    invalid(selected),
  );

  it.each(["role", "database"] as const)(
    "enforces PostgreSQL UTF-8 byte bounds for %s",
    (field) => {
      const expected = { ...target(), [field]: "é".repeat(32) };
      invalid(url, expected);
    },
  );

  it.each([
    ["missing", undefined],
    ["object", {}],
    ["empty", ""],
    ["malformed", "not a URL"],
    ["wrong protocol", url.replace("postgresql:", "https:")],
    ["leading space", ` ${url}`],
    ["trailing space", `${url} `],
    ["newline", url.replace("migration", "mi\ngration")],
    ["tab", `${url}\t`],
    ["fragment", `${url}#fragment`],
    ["empty fragment", `${url}#`],
    ["missing password", `postgresql://migration_owner@${host}/neondb`],
    ["empty password", `postgresql://migration_owner:@${host}/neondb`],
    ["missing role", `postgresql://:${secret}@${host}/neondb`],
    ["missing database", `postgresql://migration_owner:${secret}@${host}/`],
    ["extra database segment", `${url}/another`],
    ["encoded database slash", `${url}%2fanother`],
    ["wrong role", url.replace("migration_owner", "another_owner")],
    ["wrong database", url.replace("/neondb", "/another")],
    ["wrong endpoint", url.replace("ep-synthetic-123", "ep-another-456")],
    [
      "pooled endpoint",
      url.replace("ep-synthetic-123", "ep-synthetic-123-pooler"),
    ],
    ["non Neon", url.replace(".neon.tech", ".example.test")],
    ["suffix spoof", url.replace(".neon.tech", ".neon.tech.example.test")],
    ["loopback", url.replace(host, "127.0.0.1")],
    ["hostless", url.replace(host, "")],
    ["another port", url.replace(`${host}/`, `${host}:6432/`)],
    [
      "multiple hosts",
      url.replace(host, `${host},ep-another-456.eu-west-2.aws.neon.tech`),
    ],
    [
      "encoded multiple hosts",
      url.replace(host, `${host}%2cep-another-456.eu-west-2.aws.neon.tech`),
    ],
    ["ssl disable", `${url}?sslmode=disable`],
    ["ssl prefer", `${url}?sslmode=prefer`],
    ["ssl allow", `${url}?sslmode=allow`],
    ["empty ssl", `${url}?sslmode=`],
    ["duplicate ssl", `${url}?sslmode=require&sslmode=verify-full`],
    ["encoded duplicate ssl", `${url}?sslmode=require&ssl%6dode=require`],
    ["routing host option", `${url}?host=another.example.test`],
    ["routing port option", `${url}?port=6432`],
    ["routing database option", `${url}?dbname=another`],
    ["socket option", `${url}?path=%2ftmp`],
    ["startup options", `${url}?options=-c%20search_path%3Devil`],
    ["empty unknown query", `${url}?unknown=`],
    ["TLS cert option", `${url}?sslrootcert=system`],
    ["pipeline option", `${url}?max_pipeline=1000`],
    ["notice config", `${url}?application_name=other`],
    ["malformed user escape", url.replace("migration_owner", "%ZZ")],
    ["malformed password escape", url.replace(secret, "%ZZ")],
    ["malformed database escape", url.replace("neondb", "%ZZ")],
    ["encoded user NUL", url.replace("migration_owner", "migration%00_owner")],
    ["encoded password NUL", url.replace(secret, "%00")],
    ["encoded database NUL", `${url}%00`],
  ] as const)("refuses %s before constructing a driver", (_name, value) =>
    invalid(value),
  );

  it("refuses required channel binding explicitly instead of weakening it", () => {
    invalid(
      `${url}?sslmode=require&channel_binding=require`,
      target(),
      "UNSUPPORTED_CHANNEL_BINDING",
    );
  });

  it.each([
    ["null", null],
    ["array", []],
    ["missing", {}],
    ["unknown field", { ...target(), ssl: false }],
    ["nondefault port", { ...target(), port: 6432 }],
    ["string port", { ...target(), port: "5432" }],
    ["undefined host", { ...target(), host: undefined }],
    [
      "mismatched host",
      { ...target(), host: "ep-another-456.eu-west-2.aws.neon.tech" },
    ],
    ["empty role", { ...target(), role: "" }],
    ["empty database", { ...target(), database: "" }],
    ["numeric role", { ...target(), role: 1 }],
    ["overlong role", { ...target(), role: "r".repeat(64) }],
    ["overlong database", { ...target(), database: "d".repeat(64) }],
  ])("refuses %s target", (_name, expected) => invalid(url, expected));

  it("does not evaluate target getters", () => {
    const expected = target();
    const get = vi.fn(() => host);
    Object.defineProperty(expected, "host", { enumerable: true, get });
    invalid(url, expected);
    expect(get).not.toHaveBeenCalled();
  });
  it("refuses hidden fields and symbol keys", () => {
    const expected = target();
    Object.defineProperty(expected, "secret", { value: secret });
    invalid(url, expected);
    invalid(url, { ...target(), [Symbol("hidden")]: secret });
  });
  it("refuses a custom target prototype", () => {
    invalid(url, Object.assign(Object.create({ inherited: secret }), target()));
  });

  it("captures reviewed target values before handing options to the driver", async () => {
    const expected = target();
    mocks.postgres.mockImplementationOnce(() => {
      expected.host = "ep-changed-789.eu-west-2.aws.neon.tech";
      expected.role = "changed";
      expected.database = "changed";
      return client;
    });
    const connection = create(url, expected);
    expect(suppliedOptions()).toMatchObject({
      host,
      username: "migration_owner",
      database: "neondb",
    });
    await connection.close();
  });

  it("maps driver constructor failure to a fresh fixed error", () => {
    const raw = Object.assign(new Error(secret), { connection: url });
    mocks.postgres.mockImplementationOnce(() => {
      throw raw;
    });
    let caught: unknown;
    try {
      create(url, target());
    } catch (error) {
      caught = error;
    }
    safeError(caught, "INVALID_CONNECTION");
    expect(caught).not.toBe(raw);
    expect(mocks.drizzle).not.toHaveBeenCalled();
  });

  it("maps close failure to a fresh fixed error without raw details", async () => {
    const connection = create(url, target());
    mocks.end.mockRejectedValueOnce(
      Object.assign(new Error(secret), { connection: url }),
    );
    let caught: unknown;
    try {
      await connection.close();
    } catch (error) {
      caught = error;
    }
    safeError(caught, "CONNECTION_CLOSE_FAILED");
  });

  it("does not expose adapter initialization diagnostics", () => {
    mocks.drizzle.mockImplementationOnce(() => {
      throw Object.assign(new Error(secret), { client, selectedUrl: url });
    });
    let caught: unknown;
    try {
      create(url, target());
    } catch (error) {
      caught = error;
    }
    safeError(caught, "INVALID_CONNECTION");
    expect((caught as Error).stack).not.toContain(secret);
  });

  it("suppresses provider notices rather than logging their content", async () => {
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    const connection = create(url, target());
    const options = suppliedOptions();
    (options.onnotice as (v: unknown) => void)({
      message: secret,
      detail: url,
    });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    await connection.close();
  });

  it("uses actual driver parsing without ambient PG* routing, TLS, debug or timing defaults", async () => {
    const ambient = {
      PGHOST: "127.0.0.1",
      PGPORT: "1",
      PGUSER: "ambient-user",
      PGUSERNAME: "ambient-user",
      PGPASSWORD: "ambient-password",
      PGDATABASE: "ambient-db",
      PGSSL: "disable",
      PGSSLNEGOTIATION: "direct",
      PGMAX: "77",
      PGIDLE_TIMEOUT: "999",
      PGCONNECT_TIMEOUT: "999",
      PGMAX_LIFETIME: "999",
      PGMAX_PIPELINE: "999",
      PGBACKOFF: "999",
      PGKEEP_ALIVE: "999",
      PGPREPARE: "true",
      PGDEBUG: "true",
      PGFETCH_TYPES: "false",
      PGPUBLICATIONS: "ambient-publication",
      PGTARGET_SESSION_ATTRS: "standby",
      PGTARGETSESSIONATTRS: "standby",
      PGAPPNAME: "ambient-private-label",
      DATABASE_URL_DIRECT: `postgresql://ambient:ambient@127.0.0.1/ambient`,
      MIGRATION_DATABASE_URL_UNPOOLED: `postgresql://ambient:ambient@127.0.0.1/ambient`,
    };
    for (const [name, value] of Object.entries(ambient))
      vi.stubEnv(name, value);
    const actual = await vi.importActual<{ default: typeof postgres }>(
      "postgres",
    );
    const socket = vi
      .spyOn(Socket.prototype, "connect")
      .mockImplementation(() => {
        throw new Error("Unexpected network attempt in constructor test");
      });
    let parsed: ReturnType<typeof actual.default> | undefined;
    mocks.postgres.mockImplementationOnce((options) => {
      parsed = actual.default(options);
      return parsed;
    });
    const connection = create(url, target());
    try {
      expect(socket).not.toHaveBeenCalled();
      expect(parsed!.options).toMatchObject({
        host: [host],
        port: [5432],
        user: "migration_owner",
        database: "neondb",
        pass: secret,
        max: 1,
        prepare: false,
        debug: false,
        target_session_attrs: "read-write",
        sslnegotiation: "postgres",
        max_pipeline: 1,
        keep_alive: 0,
        backoff: false,
        fetch_types: false,
        publications: "alltables",
      });
      expect(parsed!.options.ssl).toMatchObject({ rejectUnauthorized: true });
      expect(parsed!.options.connect_timeout).toBeLessThanOrEqual(10);
      expect(parsed!.options.idle_timeout).toBeGreaterThan(0);
      expect(parsed!.options.idle_timeout).toBeLessThanOrEqual(10);
      expect(parsed!.options.max_lifetime).toBeGreaterThan(0);
      expect(parsed!.options.max_lifetime).toBeLessThanOrEqual(120);
      expect(parsed!.options.connection.application_name).not.toBe(
        ambient.PGAPPNAME,
      );
    } finally {
      await connection.close();
    }
    expect(socket).not.toHaveBeenCalled();
  });
});
