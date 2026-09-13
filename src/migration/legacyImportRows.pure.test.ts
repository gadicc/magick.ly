import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  importSecret,
  legacyImportFixture,
} from "../../tests/legacyImportFixtures";
import * as schema from "../db/schema";
import {
  fingerprintLegacyImportRows as fingerprint,
  LEGACY_IMPORT_TABLES,
  type LegacyImportRows,
  LegacyImportRowsError,
  projectLegacyImportRows as project,
} from "./legacyImportRows";
import {
  type PreparedLegacyImportV1,
  prepareLegacyImport,
} from "./prepareLegacyImport";

type Row = Record<string, unknown>;
const emptyTables = [
  "auth_session",
  "auth_verification",
  "ritual_compiled_artifacts",
  "ritual_write_receipts_v2",
  "temple_creation_receipts",
  "study_review_receipts",
  "ritual_upload_intents",
  "ritual_file_links",
  "ritual_bundle_publication_intents",
  "ritual_bundle_assets",
  "ritual_bundles",
] as const;
const credentials = [
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "scope",
  "password",
] as const;
function prepared() {
  const f = legacyImportFixture();
  return prepareLegacyImport(f.input, f.options);
}
function rejected(work: () => unknown) {
  let caught: unknown;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(LegacyImportRowsError);
  expect((caught as LegacyImportRowsError).code).toBe("INVALID_ROWS");
  expect((caught as Error).message).toBe("INVALID_ROWS");
  expect(Reflect.ownKeys(caught as object).sort()).toEqual([
    "code",
    "message",
    "name",
    "stack",
  ]);
}
function changed(
  mutate: (rows: LegacyImportRows) => void,
  seed?: (rows: LegacyImportRows) => void,
) {
  const before = project(prepared());
  seed?.(before);
  const receipt = fingerprint(before);
  const after = structuredClone(before);
  mutate(after);
  expect(fingerprint(after).sha256).not.toBe(receipt.sha256);
}

describe("complete legacy import row projection", () => {
  it("covers every current schema table and every column, including empty runtime tables", () => {
    const p = prepared();
    const rows = project(p);
    const schemaNames = Object.values(schema)
      .filter((value) => is(value, Table))
      .filter((table) => table !== schema.legacyImportRuns)
      .map((table) => getTableName(table))
      .sort();
    expect(schemaNames).toHaveLength(34);
    expect(Object.keys(LEGACY_IMPORT_TABLES).sort()).toEqual(schemaNames);
    expect(Object.keys(rows).sort()).toEqual(schemaNames);
    for (const name of Object.keys(rows) as (keyof LegacyImportRows)[]) {
      expect(getTableName(LEGACY_IMPORT_TABLES[name])).toBe(name);
      const keys = Object.keys(getTableColumns(LEGACY_IMPORT_TABLES[name]));
      for (const row of rows[name]) {
        expect(Object.keys(row)).toEqual(keys);
        expect(Object.values(row)).not.toContain(undefined);
      }
    }
    for (const name of emptyTables) expect(rows[name]).toEqual([]);
    expect(rows.auth_user).toHaveLength(p.auth.users.length);
    expect(rows.study_card_states).toHaveLength(p.study.cards.length);
    expect(rows.legacy_file_snapshots).toHaveLength(p.files.snapshots.length);
    expect(rows.legacy_id_aliases).toEqual(
      p.aliases.map(({ source, ...alias }) => ({ ...alias, ...source })),
    );
    expect(JSON.stringify(rows)).not.toContain(importSecret);
    const receipt = fingerprint(rows);
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.counts).toEqual(
      Object.fromEntries(
        Object.entries(rows).map(([name, r]) => [name, r.length]),
      ),
    );
    expect(Object.keys(receipt).sort()).toEqual(["counts", "sha256"]);
  });

  it("materializes nullable omissions without inventing values or changing historical null dates", () => {
    const p = prepared();
    delete p.auth.users[0].image;
    delete p.auth.profiles[0].displayName;
    const rows = project(p);
    expect(rows.auth_user[0].image).toBeNull();
    expect(rows.user_profile[0].displayName).toBeNull();
    for (const account of rows.auth_account)
      for (const key of credentials) expect(account[key]).toBeNull();
    for (const row of rows.rituals)
      expect(row.currentCompiledArtifactId).toBeNull();
    expect(rows.legacy_auth_users[0].createdAt).toBeNull();
    expect(rows.auth_user[0].createdAt).toEqual(p.importedAt);
    expect(rows.temples[0].createdById).toBeNull();
  });

  const required: [string, (p: PreparedLegacyImportV1) => Row, string][] = [
    ["user UUID", (p) => p.auth.users[0], "id"],
    ["created date", (p) => p.auth.users[0], "createdAt"],
    ["updated date", (p) => p.auth.users[0], "updatedAt"],
    ["verification flag", (p) => p.auth.users[0], "emailVerified"],
    ["email provenance UUID", (p) => p.auth.emails[0], "id"],
    ["alias UUID", (p) => p.aliases[0], "id"],
    ["alias date", (p) => p.aliases[0], "createdAt"],
    ["file metadata default", (p) => p.files.files[0], "meta"],
    ["file visibility default", (p) => p.files.files[0], "visibility"],
    ["file kind default", (p) => p.files.files[0], "kind"],
    ["file creation default", (p) => p.files.files[0], "createdAt"],
    ["ritual version default", (p) => p.rituals.rituals[0], "version"],
    ["access default", (p) => p.access[0], "admin"],
    ["grant default", (p) => p.memberships.grants[0], "member"],
  ];
  it.each(required)(
    "refuses missing %s instead of evaluating SQL defaults",
    (_name, pick, key) => {
      const p = prepared();
      delete pick(p)[key];
      rejected(() => project(p));
    },
  );

  it.each(credentials)(
    "refuses a nonnull account %s in projection and fingerprint",
    (key) => {
      const p = prepared();
      const value = key.endsWith("ExpiresAt")
        ? new Date(p.importedAt)
        : importSecret;
      (p.auth.accounts[0] as Row)[key] = value;
      rejected(() => project(p));
      const rows = project(prepared());
      rows.auth_account[0][key] = value;
      rejected(() => fingerprint(rows));
    },
  );

  it.each([
    [
      "unknown row property",
      (p: PreparedLegacyImportV1) => {
        (p.auth.users[0] as Row).rawProfile = importSecret;
      },
    ],
    [
      "undefined nullable property",
      (p: PreparedLegacyImportV1) => {
        p.auth.users[0].image = undefined;
      },
    ],
    [
      "unknown profile",
      (p: PreparedLegacyImportV1) => {
        (p as unknown as Row).profile = "other";
      },
    ],
    [
      "Date getter",
      (p: PreparedLegacyImportV1) => {
        Object.defineProperty(p.auth.users[0], "createdAt", {
          enumerable: true,
          get() {
            throw new Error(importSecret);
          },
        });
      },
    ],
  ] as const)("refuses %s with safe errors", (_name, mutate) => {
    const p = prepared();
    mutate(p);
    rejected(() => project(p));
  });

  it("binds each final current revision to its own parent while leaving input shells untouched", () => {
    const p = prepared();
    const original = structuredClone(p);
    const rows = project(p);
    for (const current of p.rituals.currentRevisions) {
      const parent = rows.rituals.find((r) => r.id === current.ritualId)!;
      const revision = rows.ritual_revisions.find(
        (r) => r.id === current.revisionId,
      )!;
      expect(parent.currentRevisionId).toBe(revision.id);
      expect(revision.ritualId).toBe(parent.id);
    }
    expect(p).toEqual(original);
    expect(p.rituals.rituals.every((r) => r.currentRevisionId === null)).toBe(
      true,
    );
  });

  it.each([
    [
      "cross-parent revision",
      (p: PreparedLegacyImportV1) => {
        p.rituals.currentRevisions[0].revisionId =
          p.rituals.currentRevisions[1].revisionId;
      },
    ],
    [
      "missing parent selection",
      (p: PreparedLegacyImportV1) => {
        p.rituals.currentRevisions.pop();
      },
    ],
    [
      "duplicate selection",
      (p: PreparedLegacyImportV1) => {
        p.rituals.currentRevisions.push({ ...p.rituals.currentRevisions[0] });
      },
    ],
    [
      "unknown revision",
      (p: PreparedLegacyImportV1) => {
        p.rituals.currentRevisions[0].revisionId = p.auth.users[0].id;
      },
    ],
    [
      "unknown parent",
      (p: PreparedLegacyImportV1) => {
        p.rituals.currentRevisions[0].ritualId = p.auth.users[0].id;
      },
    ],
    [
      "preselected shell",
      (p: PreparedLegacyImportV1) => {
        p.rituals.rituals[0].currentRevisionId =
          p.rituals.currentRevisions[0].revisionId;
      },
    ],
    [
      "duplicate parent",
      (p: PreparedLegacyImportV1) => {
        p.rituals.rituals.push(structuredClone(p.rituals.rituals[0]));
      },
    ],
    [
      "duplicate revision",
      (p: PreparedLegacyImportV1) => {
        p.rituals.revisions.push(structuredClone(p.rituals.revisions[0]));
      },
    ],
  ] as const)("refuses %s", (_name, mutate) => {
    const p = prepared();
    mutate(p);
    rejected(() => project(p));
  });

  it("owns projected Dates, nested JSON and rows independently of both caller and returned values", () => {
    const p = prepared();
    const rows = project(p);
    const original = structuredClone(rows);
    const saved = fingerprint(rows);
    p.auth.users[0].createdAt.setTime(0);
    p.auth.users[0].name = "changed";
    p.auth.emails[0].evidence[0].verified = false;
    p.aliases[0].source.legacyIdValue = "changed";
    expect(rows).toEqual(original);
    expect(fingerprint(rows)).toEqual(saved);
    (rows.auth_user[0].createdAt as Date).setTime(1);
    (rows.legacy_user_emails[0].evidence as Row[])[0].verified = "changed";
    expect(p.auth.users[0].createdAt.getTime()).toBe(0);
    expect(p.auth.emails[0].evidence[0].verified).toBe(false);
    saved.counts.auth_user = 999;
    expect(fingerprint(original).counts.auth_user).toBe(
      original.auth_user.length,
    );
  });
});

describe("complete legacy import row fingerprints", () => {
  it("ignores table, row and object-property ordering but preserves row multiplicity", () => {
    const rows = project(prepared());
    const original = structuredClone(rows);
    const receipt = fingerprint(rows);
    const reversed = Object.fromEntries(
      Object.entries(rows)
        .reverse()
        .map(([name, entries]) => [
          name,
          [...entries]
            .reverse()
            .map((row) => Object.fromEntries(Object.entries(row).reverse())),
        ]),
    ) as LegacyImportRows;
    expect(fingerprint(reversed)).toEqual(receipt);
    expect(rows).toEqual(original);
    reversed.auth_user.push(structuredClone(reversed.auth_user[0]));
    const duplicate = fingerprint(reversed);
    expect(duplicate.counts.auth_user).toBe(receipt.counts.auth_user + 1);
    expect(duplicate.sha256).not.toBe(receipt.sha256);
  });

  it("canonicalizes only JSONB object key order, including own special and Unicode keys", () => {
    const rows = project(prepared());
    rows.loom_files[0].meta = JSON.parse(
      '{"z":{"y":1,"x":2},"__proto__":{"safe":true},"constructor":"value","é":[{"b":2,"a":1},null]}',
    );
    const reordered = structuredClone(rows);
    reordered.loom_files[0].meta = JSON.parse(
      '{"é":[{"a":1,"b":2},null],"constructor":"value","__proto__":{"safe":true},"z":{"x":2,"y":1}}',
    );
    expect(fingerprint(reordered)).toEqual(fingerprint(rows));
    expect(Object.hasOwn(rows.loom_files[0].meta as object, "__proto__")).toBe(
      true,
    );
    delete (reordered.loom_files[0].meta as Row).__proto__;
    expect(fingerprint(reordered).sha256).not.toBe(fingerprint(rows).sha256);
    expect(Object.getPrototypeOf(rows.loom_files[0].meta)).toBe(
      Object.prototype,
    );
  });

  it.each([
    [
      "array order",
      (m: Row) => {
        (m.list as unknown[]).reverse();
      },
    ],
    [
      "array duplicate",
      (m: Row) => {
        (m.list as unknown[]).push("first");
      },
    ],
    [
      "missing key",
      (m: Row) => {
        delete m.present;
      },
    ],
    [
      "nested string normalization",
      (m: Row) => {
        m.text = "é";
      },
    ],
  ] as const)("binds JSONB %s", (_name, mutate) => {
    changed(
      (rows) => mutate(rows.loom_files[0].meta as Row),
      (rows) => {
        rows.loom_files[0].meta = {
          list: ["first", "second"],
          present: null,
          text: "e\u0301",
        };
      },
    );
  });

  it.each([
    [
      "source BOM",
      (rows: LegacyImportRows) => {
        rows.ritual_revisions[0].source = (
          rows.ritual_revisions[0].source as string
        ).replace(/^\uFEFF/, "");
      },
    ],
    [
      "source line endings",
      (rows: LegacyImportRows) => {
        rows.ritual_revisions[0].source = (
          rows.ritual_revisions[0].source as string
        ).replaceAll("\r\n", "\n");
      },
    ],
    [
      "source Unicode normalization",
      (rows: LegacyImportRows) => {
        rows.ritual_revisions[0].source = (
          rows.ritual_revisions[0].source as string
        ).normalize("NFC");
      },
    ],
    [
      "archive JSON spacing",
      (rows: LegacyImportRows) => {
        rows.legacy_ritual_compiled_archives[0].contentJson = JSON.stringify(
          JSON.parse(
            rows.legacy_ritual_compiled_archives[0].contentJson as string,
          ),
          null,
          2,
        );
      },
    ],
    [
      "EJSON spacing",
      (rows: LegacyImportRows) => {
        rows.legacy_file_snapshots[0].sourceEjson = `${rows.legacy_file_snapshots[0].sourceEjson} `;
      },
    ],
    [
      "filename BOM",
      (rows: LegacyImportRows) => {
        rows.loom_files[0].originalFilename = (
          rows.loom_files[0].originalFilename as string
        ).replace(/^\uFEFF/, "");
      },
    ],
    [
      "typed alias",
      (rows: LegacyImportRows) => {
        rows.legacy_id_aliases[0].legacyIdType =
          rows.legacy_id_aliases[0].legacyIdType === "string"
            ? "objectid"
            : "string";
      },
    ],
  ] as const)(
    "binds exact %s bytes independently of archive/hash columns",
    (_name, mutate) => {
      changed(mutate, (rows) => {
        rows.ritual_revisions[0].source = `\uFEFF${rows.ritual_revisions[0].source}`;
      });
    },
  );

  it.each([
    [
      "Date millisecond",
      (rows: LegacyImportRows) => {
        const d = rows.auth_user[0].createdAt as Date;
        d.setTime(d.getTime() + 1);
      },
    ],
    [
      "naive file timestamp",
      (rows: LegacyImportRows) => {
        const d = rows.loom_files[0].createdAt as Date;
        d.setTime(d.getTime() + 1);
      },
    ],
    [
      "historical null",
      (rows: LegacyImportRows) => {
        rows.legacy_auth_users[0].createdAt = new Date(0);
      },
    ],
    [
      "optional image metadata",
      (rows: LegacyImportRows) => {
        rows.loom_files[0].audioMeta = {};
      },
    ],
  ] as const)("binds %s", (_name, mutate) => changed(mutate));

  it.each([
    [
      "missing table",
      (rows: LegacyImportRows) => {
        delete (rows as Partial<LegacyImportRows>).auth_session;
      },
    ],
    [
      "unknown table",
      (rows: LegacyImportRows) => {
        (rows as unknown as Row).unknown = [];
      },
    ],
    [
      "nonarray table",
      (rows: LegacyImportRows) => {
        (rows as unknown as Row).auth_session = {};
      },
    ],
    [
      "missing nullable column",
      (rows: LegacyImportRows) => {
        delete rows.auth_user[0].image;
      },
    ],
    [
      "unknown row column",
      (rows: LegacyImportRows) => {
        rows.auth_user[0].unknown = importSecret;
      },
    ],
    [
      "null required column",
      (rows: LegacyImportRows) => {
        rows.auth_user[0].name = null;
      },
    ],
    [
      "invalid Date",
      (rows: LegacyImportRows) => {
        rows.auth_user[0].createdAt = new Date(Number.NaN);
      },
    ],
    [
      "date-looking string",
      (rows: LegacyImportRows) => {
        rows.auth_user[0].createdAt = "2020-01-01T00:00:00.000Z";
      },
    ],
    [
      "Date in JSONB",
      (rows: LegacyImportRows) => {
        rows.loom_files[0].meta = { at: new Date(0) };
      },
    ],
    [
      "undefined JSONB member",
      (rows: LegacyImportRows) => {
        rows.loom_files[0].meta = { value: undefined };
      },
    ],
    [
      "uppercase UUID",
      (rows: LegacyImportRows) => {
        rows.auth_user[0].id = "01993000-0000-7000-8000-000000000ABC";
      },
    ],
    [
      "invalid enum",
      (rows: LegacyImportRows) => {
        rows.legacy_id_aliases[0].legacyIdType = "number";
      },
    ],
    [
      "numeric string",
      (rows: LegacyImportRows) => {
        rows.study_progress[0].correct = "2";
      },
    ],
    [
      "unsafe integer",
      (rows: LegacyImportRows) => {
        rows.study_progress[0].correct = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "fractional count",
      (rows: LegacyImportRows) => {
        rows.study_progress[0].correct = 0.5;
      },
    ],
    [
      "boolean coercion",
      (rows: LegacyImportRows) => {
        rows.user_access[0].admin = 1;
      },
    ],
    [
      "infinite scheduling value",
      (rows: LegacyImportRows) => {
        rows.study_card_states[0].efactor = Infinity;
      },
    ],
    [
      "negative zero",
      (rows: LegacyImportRows) => {
        rows.study_card_states[0].interval = -0;
      },
    ],
    [
      "NUL text",
      (rows: LegacyImportRows) => {
        rows.ritual_revisions[0].source = "before\0after";
      },
    ],
    [
      "lone surrogate",
      (rows: LegacyImportRows) => {
        rows.auth_user[0].name = "\ud800";
      },
    ],
    [
      "sparse array",
      (rows: LegacyImportRows) => {
        rows.auth_user.length += 1;
      },
    ],
    [
      "symbol property",
      (rows: LegacyImportRows) => {
        Object.defineProperty(rows.auth_user[0], Symbol("secret"), {
          value: importSecret,
        });
      },
    ],
    [
      "accessor",
      (rows: LegacyImportRows) => {
        Object.defineProperty(rows.auth_user[0], "name", {
          enumerable: true,
          get() {
            throw new Error(importSecret);
          },
        });
      },
    ],
  ] as const)(
    "refuses %s without leaking malformed content",
    (_name, mutate) => {
      const rows = project(prepared());
      mutate(rows);
      rejected(() => fingerprint(rows));
    },
  );

  it("preserves legitimate fractional scheduling values and JSON-looking text without revival", () => {
    const rows = project(prepared());
    rows.study_card_states[0].interval = 3.125;
    rows.study_card_states[0].efactor = 2.675;
    rows.auth_user[0].name = '"2020-01-01T00:00:00Z"';
    expect(fingerprint(structuredClone(rows))).toEqual(fingerprint(rows));
  });

  it("refuses an oversized total row multiset before producing acceptance evidence", () => {
    const original = project(prepared());
    const rows = { ...original };
    for (const name of Object.keys(rows) as (keyof LegacyImportRows)[])
      rows[name] = [];
    rows.user_access = Array.from({ length: 100_001 }, () => ({
      userId: original.auth_user[0].id,
      admin: false,
    }));
    rejected(() => fingerprint(rows));
  });
});
