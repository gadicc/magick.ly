import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  importSecret,
  legacyImportFixture,
} from "../../tests/legacyImportFixtures";
import {
  createLegacyImportCheckpoint as create,
  type LegacyImportBinding,
  LegacyImportCheckpointError,
  readLegacyImportCheckpoint as read,
} from "./legacyImportCheckpoint";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";
import { prepareLegacyImport } from "./prepareLegacyImport";

const binding = (): LegacyImportBinding => ({
  runId: "01993000-0000-7000-8000-000000000aaa",
  sourceManifestSha256: "a".repeat(64),
  sourceDescriptorSha256: "b".repeat(64),
  schemaSha256: "c".repeat(64),
  targetSha256: "d".repeat(64),
});
const prepared = () => {
  const f = legacyImportFixture();
  return prepareLegacyImport(f.input, f.options);
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Row = Record<string, unknown>;
function rejected(work: () => unknown) {
  try {
    work();
    throw new Error("expected refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyImportCheckpointError);
    expect((error as Error).message).toBe("INVALID_IMPORT_CHECKPOINT");
    expect(Reflect.ownKeys(error as object).sort()).toEqual([
      "message",
      "name",
      "stack",
    ]);
  }
}
describe("immutable prepared import checkpoint", () => {
  it("round-trips all domain data and IDs without allocating or recompiling", () => {
    const plan = prepared(),
      b = binding(),
      saved = create(plan, b);
    const restored = read(saved, b);
    expect(isDeepStrictEqual(restored, plan)).toBe(true);
    expect(saved.payloadSha256).toBe(hash(saved.payload));
    expect(saved.configurationSha256).toBe(
      hash(serializeLegacyImportValue(plan.config)),
    );
    expect(create(restored, b)).toEqual(saved);
    expect(saved.payload).not.toContain(importSecret);
    expect(restored.auth.users[0].createdAt).toBeInstanceOf(Date);
    expect(restored.study.snapshots[0].sourceEjson).toBe(
      plan.study.snapshots[0].sourceEjson,
    );
    expect(restored.aliases.map((a) => a.id)).toEqual(
      plan.aliases.map((a) => a.id),
    );
    expect(restored).not.toBe(plan);
  });
  it("owns saved and reopened values across caller mutations", () => {
    const plan = prepared(),
      b = binding(),
      saved = create(plan, b);
    const original = read(saved, b);
    plan.importedAt.setTime(0);
    plan.auth.users[0].name = "modified";
    plan.config.files.sourceBucket = "modified";
    const restored = read(saved, b);
    expect(isDeepStrictEqual(restored, original)).toBe(true);
    restored.aliases[0].id = "modified";
    expect(read(saved, b).aliases[0].id).toBe(original.aliases[0].id);
  });
  it("uses canonical binding property order without changing values", () => {
    const plan = prepared(),
      b = binding();
    expect(
      create(
        plan,
        Object.fromEntries(
          Object.entries(b).reverse(),
        ) as unknown as LegacyImportBinding,
      ),
    ).toEqual(create(plan, b));
  });
  it.each(Object.keys(binding()) as (keyof LegacyImportBinding)[])(
    "rejects a different %s on resume",
    (key) => {
      const b = binding(),
        saved = create(prepared(), b);
      b[key] =
        key === "runId"
          ? "01993000-0000-7000-8000-000000000aab"
          : "e".repeat(64);
      rejected(() => read(saved, b));
    },
  );
  it.each([
    (v: LegacyImportBinding) => {
      v.runId = v.runId.toUpperCase();
    },
    (v: LegacyImportBinding) => {
      v.runId = "wrong";
    },
    (v: LegacyImportBinding) => {
      v.targetSha256 = "D".repeat(64);
    },
    (v: LegacyImportBinding) => {
      v.sourceManifestSha256 = "";
    },
    (v: LegacyImportBinding) => {
      (v as unknown as Row).extra = importSecret;
    },
    (v: LegacyImportBinding) => {
      delete (v as unknown as Row).schemaSha256;
    },
    (v: LegacyImportBinding) => {
      Object.defineProperty(v, "targetSha256", {
        get() {
          throw new Error(importSecret);
        },
        enumerable: true,
      });
    },
  ])("rejects invalid binding %# before creating or reading", (mutate) => {
    const p = prepared(),
      saved = create(p, binding()),
      b = binding();
    mutate(b);
    rejected(() => create(p, b));
    rejected(() => read(saved, b));
  });
  it.each([null, [], {}, new Date(), Object.create(null)])(
    "rejects unsupported binding container %#",
    (value) => {
      rejected(() => create(prepared(), value as never));
    },
  );
  it.each([
    (v: Row) => {
      v.profile = "wrong";
    },
    (v: Row) => {
      v.importedAt = "2026-01-01";
    },
    (v: Row) => {
      v.importedAt = new Date("invalid");
    },
    (v: Row) => {
      v.config = null;
    },
    (v: Row) => {
      v.config = { profile: "wrong" };
    },
    (v: Row) => {
      v.extra = importSecret;
    },
    (v: Row) => {
      delete v.aliases;
    },
    (v: Row) => {
      Object.defineProperty(v, "config", {
        get() {
          throw new Error(importSecret);
        },
        enumerable: true,
      });
    },
  ])("refuses an unsupported prepared value %#", (mutate) => {
    const p = prepared();
    mutate(p as unknown as Row);
    rejected(() => create(p, binding()));
  });
  it.each([
    (v: Row) => {
      v.payload = `${v.payload} `;
    },
    (v: Row) => {
      v.payload = 123;
    },
    (v: Row) => {
      v.payloadSha256 = "invalid";
    },
    (v: Row) => {
      v.payloadSha256 = "0".repeat(64);
    },
    (v: Row) => {
      v.configurationSha256 = "invalid";
    },
    (v: Row) => {
      v.configurationSha256 = "0".repeat(64);
    },
    (v: Row) => {
      v.extra = importSecret;
    },
    (v: Row) => {
      Object.defineProperty(v, "payload", {
        value: "private",
        enumerable: false,
      });
    },
  ])("refuses a damaged durable header or payload %#", (mutate) => {
    const saved = create(prepared(), binding());
    mutate(saved as unknown as Row);
    rejected(() => read(saved, binding()));
  });
  it.each([
    (v: Row) => {
      v.profile = "wrong";
    },
    (v: Row) => {
      v.extra = true;
    },
    (v: Row) => {
      (v.binding as Row).targetSha256 = "e".repeat(64);
    },
    (v: Row) => {
      (v.prepared as Row).profile = "wrong";
    },
    (v: Row) => {
      ((v.prepared as Row).config as Row).sourceForumOrigin =
        "https://changed.example.test";
    },
  ])(
    "checks bindings and config independently of a changed outer checksum %#",
    (mutate) => {
      const saved = create(prepared(), binding());
      const value = parseLegacyImportValue(saved.payload) as Row;
      mutate(value);
      saved.payload = serializeLegacyImportValue(value);
      saved.payloadSha256 = hash(saved.payload);
      rejected(() => read(saved, binding()));
    },
  );
  it("rejects noncanonical JSON even when its checksum agrees", () => {
    const saved = create(prepared(), binding());
    saved.payload += " ";
    saved.payloadSha256 = hash(saved.payload);
    rejected(() => read(saved, binding()));
  });
});
