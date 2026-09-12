import { createHash } from "node:crypto";
import { EJSON, ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import { fixture, key, source } from "../../tests/studyFixtures";
import { createUuidV7 } from "../lib/ids";
import {
  LegacyStudyImportError,
  planLegacyStudyImport,
} from "./planLegacyStudyImport";

const cards = (test: ReturnType<typeof fixture>, index = 0) =>
  test.input[index].cards as Record<string, Record<string, unknown>>;

describe("legacy study import planning", () => {
  it("reconciles the audited counts with a synthetic 49-row shape without fabricating active duplicate state", () => {
    const test = fixture(true);
    const plan = planLegacyStudyImport(test.input, test.options());
    expect(plan.counts).toEqual({
      sourceRows: 49,
      canonicalRows: 48,
      archivedDuplicateRows: 1,
      sourceCards: 667,
      canonicalCards: 656,
      archivedCards: 11,
      sourceRepetitions: 459,
      canonicalRepetitions: 459,
      archivedRepetitions: 0,
      quirkRows: 1,
      aggregateMismatchRows: 11,
    });
    expect(plan.progress).toHaveLength(48);
    expect(plan.cards).toHaveLength(656);
    expect(plan.snapshots).toHaveLength(49);
    expect(
      plan.evidence.filter((row) => row.aggregateMismatches.length),
    ).toHaveLength(11);
    expect(plan.evidence[0].aggregateMismatches).toEqual(["correct", "time"]);
  });

  it("preserves inconsistent aggregates, set due date and card schedules independently", () => {
    const test = fixture();
    const plan = planLegacyStudyImport(test.input, test.options());
    expect(plan.progress[0]).toMatchObject({
      correct: 5,
      incorrect: 0,
      time: 2545,
      dueDate: test.input[0].dueDate,
      createdAt: null,
      updatedAt: null,
      version: 0,
    });
    expect(plan.cards.slice(0, 2).map((row) => row.correct)).toEqual([2, 2]);
    expect(plan.cards[0].dueDate).not.toBe(plan.progress[0].dueDate);
    expect(
      plan.cards.filter((row) => row.repetitionWeight === null),
    ).toHaveLength(2);
    expect(plan.cards[0].repetitionWeight).toBe(0);
    expect(plan.evidence[0].presentFields).toContain("quirk");
    expect(plan.progress[0]).not.toHaveProperty("quirk");
  });

  it("archives exact typed snapshots including empty cards, quirk and absent repetition", () => {
    const test = fixture();
    const plan = planLegacyStudyImport(test.input, test.options());
    plan.snapshots.forEach((snapshot, i) => {
      expect(snapshot.sourceEjson).toBe(
        EJSON.stringify(test.input[i], { relaxed: false }),
      );
      expect(snapshot.sourceSha256).toBe(
        createHash("sha256").update(snapshot.sourceEjson!).digest("hex"),
      );
      const revived = EJSON.parse(snapshot.sourceEjson!, { relaxed: true });
      expect(revived._id.toHexString()).toBe(
        (test.input[i]._id as ObjectId).toHexString(),
      );
      expect(revived.dueDate).toEqual(test.input[i].dueDate);
      expect(revived.cards["card-0"].dueDate).toBeInstanceOf(Date);
    });
    const original = EJSON.parse(plan.snapshots[0].sourceEjson!, {
      relaxed: true,
    });
    expect(original.quirk.at).toBeInstanceOf(Date);
    expect(Object.is(original.quirk.token, -0)).toBe(true);
    const duplicate = EJSON.parse(plan.snapshots[2].sourceEjson!, {
      relaxed: true,
    });
    expect(duplicate.cards["card-0"]).not.toHaveProperty("repetition");
    expect(plan.snapshots[2]).toMatchObject({
      progressId: plan.progress[0].id,
      disposition: "empty-duplicate",
    });
    expect(plan.evidence[2]).toMatchObject({
      keptSource: test.keep,
      disposition: "empty-duplicate",
    });
  });

  it("aliases only the explicit empty row and reruns with the same canonical IDs", () => {
    const test = fixture();
    for (const [sourceKey, id] of test.ids)
      test.ids.set(sourceKey, id.toUpperCase());
    const first = planLegacyStudyImport(test.input, test.options());
    expect(first.aliases[2].canonicalId).toBe(first.aliases[0].canonicalId);
    for (const alias of first.aliases)
      test.ids.set(key(alias.source), alias.canonicalId);
    expect(planLegacyStudyImport(test.input, test.options())).toEqual(first);
    test.ids.delete(key(test.archive));
    expect(planLegacyStudyImport(test.input, test.options())).toEqual(first);
  });

  it("never merges unapproved pairs or two reviewed histories", () => {
    const test = fixture();
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [],
      }),
    ).toThrow(/duplicate-canonical-identity|unapproved-duplicate/);
    test.input[2].correct = 1;
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /duplicate-not-empty-vs-reviewed/,
    );
    test.input[2].correct = 0;
    cards(test, 2)["card-0"].time = 1;
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /duplicate-not-empty-vs-reviewed/,
    );
  });

  it.each([
    [
      "interval",
      (card: Record<string, unknown>) => {
        (card.supermemo as Record<string, unknown>).interval = 30;
      },
    ],
    [
      "repetition",
      (card) => {
        (card.supermemo as Record<string, unknown>).repetition = 4;
      },
    ],
    [
      "ease",
      (card) => {
        (card.supermemo as Record<string, unknown>).efactor = 1.7;
      },
    ],
    [
      "weight",
      (card) => {
        card.repetition = { weight: 5 };
      },
    ],
  ] satisfies [string, (card: Record<string, unknown>) => void][])(
    "rejects zero-counter duplicate whose %s changed after review",
    (_field, change) => {
      const test = fixture();
      change(cards(test, 2)["card-0"]);
      expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
        /duplicate-source-fingerprint-mismatch/,
      );
    },
  );

  it("requires a fixed reviewed fingerprint, including metadata, and preserves its evidence", () => {
    const test = fixture();
    const pair = test.options().emptyDuplicates[0];
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [{ ...pair, expectedArchiveSha256: undefined }],
      } as never),
    ).toThrow(/invalid-duplicate-fingerprint/);
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [{ ...pair, expectedArchiveSha256: "bad" }],
      }),
    ).toThrow(/invalid-duplicate-fingerprint/);
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [{ ...pair, expectedArchiveSha256: "0".repeat(64) }],
      }),
    ).toThrow(/duplicate-source-fingerprint-mismatch/);
    const plan = planLegacyStudyImport(test.input, test.options());
    expect(plan.evidence[2].approvedArchiveSha256).toBe(
      pair.expectedArchiveSha256,
    );
    expect(plan.snapshots[2].sourceSha256).toBe(pair.expectedArchiveSha256);
    test.input[2].dueDate = new Date("2026-09-12T15:00:00Z");
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /duplicate-source-fingerprint-mismatch/,
    );
  });

  it("can archive an explicitly reviewed noninitial schedule without asserting it was untouched", () => {
    const test = fixture();
    (cards(test, 2)["card-0"].supermemo as Record<string, unknown>).interval =
      30;
    const reviewedSourceSha256 = createHash("sha256")
      .update(EJSON.stringify(test.input[2], { relaxed: false }), "utf8")
      .digest("hex");
    const options = {
      ...test.options(),
      emptyDuplicates: [
        {
          ...test.options().emptyDuplicates[0],
          expectedArchiveSha256: reviewedSourceSha256,
        },
      ],
    };
    const plan = planLegacyStudyImport(test.input, options);
    expect(
      EJSON.parse(plan.snapshots[2].sourceEjson!, { relaxed: true }).cards[
        "card-0"
      ].supermemo.interval,
    ).toBe(30);
    expect(plan.progress[0].correct).toBe(5);
    expect(plan.evidence[2].approvedArchiveSha256).toBe(reviewedSourceSha256);
  });

  it("preserves absent, empty and zero-weight repetition distinctly", () => {
    const test = fixture();
    cards(test, 1)["card-1"].repetition = {};
    const plan = planLegacyStudyImport(test.input, test.options());
    const second = plan.cards.filter(
      (card) => card.progressId === plan.progress[1].id,
    );
    expect(second[0]).toMatchObject({
      repetitionPresent: true,
      repetitionWeight: 0,
    });
    expect(second[1]).toMatchObject({
      repetitionPresent: true,
      repetitionWeight: null,
    });
    expect(second[2]).toMatchObject({
      repetitionPresent: false,
      repetitionWeight: null,
    });
    expect(plan.counts.sourceRepetitions).toBe(4);
    expect(
      EJSON.parse(plan.snapshots[1].sourceEjson!, { relaxed: true }).cards[
        "card-1"
      ].repetition,
    ).toEqual({});
  });

  it("requires exact pair ownership, set, card keys and compatible aliases", () => {
    const test = fixture();
    test.input[2].userId = test.users[1];
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /duplicate-pair-mismatch/,
    );
    test.input[2].userId = test.users[0];
    test.input[2].setId = "another set";
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /duplicate-pair-mismatch/,
    );
    test.input[2].setId = "synthetic-set-0";
    delete cards(test, 2)["card-0"];
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /duplicate-card-keys-differ/,
    );
    const another = fixture();
    another.ids.set(key(another.archive), createUuidV7());
    expect(() =>
      planLegacyStudyImport(another.input, another.options()),
    ).toThrow(/duplicate-alias-conflict/);
  });

  it("preserves typed user references and rejects unclaimed cross-type matches", () => {
    const test = fixture();
    test.input[0].userId = test.users[0].toHexString();
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /unresolved-user/,
    );
    test.ids.set(
      key(source("users", test.users[0].toHexString())),
      test.options().canonicalUserIds[0],
    );
    expect(
      planLegacyStudyImport(test.input, test.options()).evidence[0].userSource
        .legacyIdType,
    ).toBe("string");
  });

  it("validates import envelopes, mappings and exact duplicate declarations", () => {
    const test = fixture();
    expect(() => planLegacyStudyImport(null as never, test.options())).toThrow(
      /invalid-input-array/,
    );
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        canonicalUserIds: null,
      } as never),
    ).toThrow(/invalid-options/);
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        canonicalUserIds: ["wrong"],
      }),
    ).toThrow(/invalid-user-set/);
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        canonicalUserIds: [
          ...test.options().canonicalUserIds,
          test.options().canonicalUserIds[0].toUpperCase(),
        ],
      }),
    ).toThrow(/invalid-user-set/);
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [
          {
            ...test.options().emptyDuplicates[0],
            keep: { ...test.keep, entityType: "docs" },
            archive: test.archive,
          },
        ],
      }),
    ).toThrow(/invalid-duplicate-declaration/);
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [
          {
            ...test.options().emptyDuplicates[0],
            keep: test.keep,
            archive: test.keep,
          },
        ],
      }),
    ).toThrow(/overlapping-duplicate-declaration/);
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [
          ...test.options().emptyDuplicates,
          ...test.options().emptyDuplicates,
        ],
      }),
    ).toThrow(/overlapping-duplicate-declaration/);
    expect(() =>
      planLegacyStudyImport([test.input[0], test.input[0]], test.options()),
    ).toThrow(/duplicate-source-id/);
    test.ids.delete(key(test.keep));
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /missing-canonical-alias/,
    );
    test.ids.set(key(test.keep), "invalid canonical UUID");
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /invalid-canonical-alias/,
    );
  });

  it("requires both declared rows and refuses accidental user/set merges even when aliases differ", () => {
    const test = fixture();
    expect(() =>
      planLegacyStudyImport(test.input.slice(1), test.options()),
    ).toThrow(/missing-kept-duplicate/);
    expect(() =>
      planLegacyStudyImport(test.input.slice(0, 2), test.options()),
    ).toThrow(/unused-duplicate-declaration/);
    test.ids.set(key(test.archive), createUuidV7());
    expect(() =>
      planLegacyStudyImport(test.input, {
        ...test.options(),
        emptyDuplicates: [],
      }),
    ).toThrow(/unapproved-duplicate-user-set/);
    const fresh = fixture();
    fresh.input[0].correct = 0;
    fresh.input[0].time = 0;
    for (const card of Object.values(cards(fresh))) {
      card.correct = 0;
      card.time = 0;
    }
    expect(() => planLegacyStudyImport(fresh.input, fresh.options())).toThrow(
      /duplicate-not-empty-vs-reviewed/,
    );
  });

  it("rejects malformed BSON IDs and unsupported snapshot values without dropping them", () => {
    for (const id of [
      { invalid: true },
      { _bsontype: "ObjectId", toHexString: () => "wrong" },
      {
        _bsontype: "ObjectId",
        toHexString: () => {
          throw new Error("private");
        },
      },
    ]) {
      const test = fixture();
      test.input[0]._id = id;
      expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
        /invalid-source-id/,
      );
    }
    for (const quirk of [
      new Map(),
      new Array(1),
      { [Symbol("key")]: true },
      Object.assign(new Array(1), { extra: true }),
      { run: () => 1 },
    ]) {
      const test = fixture();
      test.input[0].quirk = quirk;
      expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
        /unsupported-snapshot-value/,
      );
    }
    const test = fixture();
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    test.input[0].quirk = cyclic;
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /unsupported-snapshot-value/,
    );
  });

  it("rejects ambiguous EJSON tag objects instead of silently changing quirk provenance on revival", () => {
    for (const quirk of [
      { $numberInt: "4" },
      { $date: "2020-01-01T00:00:00Z" },
      { $oid: "000000000000000000000001" },
    ]) {
      const test = fixture();
      test.input[0].quirk = quirk;
      expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
        /snapshot-roundtrip-loss/,
      );
    }
    const test = fixture();
    test.input[0].quirk = { $oid: "invalid" };
    expect(() => planLegacyStudyImport(test.input, test.options())).toThrow(
      /snapshot-serialization-failed/,
    );
  });

  it("preserves empty states, history, arbitrary content keys and does not alias mutable output", () => {
    const test = fixture();
    test.input[1].cards = Object.create(null);
    test.input[1].createdAt = new Date("2020-01-01T00:00:00.123Z");
    test.input[1].updatedAt = null;
    delete test.input[1].__updatedAt;
    const plan = planLegacyStudyImport(test.input, test.options());
    expect(plan.progress[1]).toMatchObject({
      createdAt: test.input[1].createdAt,
      updatedAt: null,
      legacySyncUpdatedAtMilliseconds: null,
    });
    expect(
      plan.cards.filter((card) => card.progressId === plan.progress[1].id),
    ).toEqual([]);
    const original = (test.input[0].dueDate as Date).getTime();
    plan.progress[0].dueDate!.setTime(0);
    plan.cards[0].dueDate!.setTime(0);
    expect((test.input[0].dueDate as Date).getTime()).toBe(original);
    expect((cards(test)["card-0"].dueDate as Date).getTime()).not.toBe(0);
    expect(plan.evidence[0].source).not.toBe(test.keep);
  });

  it.each([
    [
      "source marker",
      (t: ReturnType<typeof fixture>) => {
        t.input[0].__deleted = false;
      },
      "unclassified-fields",
    ],
    [
      "unknown card data",
      (t) => {
        cards(t)["card-0"].privateField = "sensitive";
      },
      "unclassified-fields",
    ],
    [
      "ownerless server row",
      (t) => {
        delete t.input[0].userId;
      },
      "invalid-object",
    ],
    [
      "unknown owner",
      (t) => {
        t.input[0].userId = new ObjectId();
      },
      "unresolved-user",
    ],
    [
      "empty set key",
      (t) => {
        t.input[0].setId = "";
      },
      "invalid-text",
    ],
    [
      "NUL key",
      (t) => {
        t.input[0].setId = "private\0key";
      },
      "unrepresentable-text",
    ],
    [
      "negative aggregate",
      (t) => {
        t.input[0].correct = -1;
      },
      "invalid-counter",
    ],
    [
      "fractional aggregate",
      (t) => {
        t.input[0].time = 0.1;
      },
      "invalid-counter",
    ],
    [
      "unsafe aggregate",
      (t) => {
        t.input[0].incorrect = Number.MAX_SAFE_INTEGER + 1;
      },
      "invalid-counter",
    ],
    [
      "non-Date due",
      (t) => {
        t.input[0].dueDate = "2026-01-01";
      },
      "invalid-date",
    ],
    [
      "invalid card due",
      (t) => {
        cards(t)["card-0"].dueDate = new Date(NaN);
      },
      "invalid-date",
    ],
    [
      "missing card due",
      (t) => {
        delete cards(t)["card-0"].dueDate;
      },
      "invalid-date",
    ],
    [
      "explicit null repetition",
      (t) => {
        cards(t)["card-0"].repetition = null;
      },
      "invalid-object",
    ],
    [
      "explicit null weight",
      (t) => {
        cards(t)["card-0"].repetition = { weight: null };
      },
      "invalid-counter",
    ],
    [
      "negative weight",
      (t) => {
        cards(t)["card-0"].repetition = { weight: -1 };
      },
      "invalid-counter",
    ],
    [
      "nonfinite interval",
      (t) => {
        (cards(t)["card-0"].supermemo as Record<string, unknown>).interval =
          Infinity;
      },
      "invalid-interval",
    ],
    [
      "nonpositive efactor",
      (t) => {
        (cards(t)["card-0"].supermemo as Record<string, unknown>).efactor = 0;
      },
      "invalid-efactor",
    ],
    [
      "unknown ObjectID metadata",
      (t) => {
        t.input[0].__ObjectIDs = ["other"];
      },
      "invalid-objectid-metadata",
    ],
    [
      "unsupported quirk",
      (t) => {
        t.input[0].quirk = undefined;
      },
      "unsupported-snapshot-value",
    ],
    [
      "null sync",
      (t) => {
        t.input[0].__updatedAt = null;
      },
      "invalid-counter",
    ],
  ] satisfies [string, (test: ReturnType<typeof fixture>) => void, string][])(
    "rejects %s with only category/position errors",
    (_name, mutate, code) => {
      const test = fixture();
      mutate(test);
      try {
        planLegacyStudyImport(test.input, test.options());
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyStudyImportError);
        expect((error as LegacyStudyImportError).code).toBe(code);
        expect((error as Error).message).not.toMatch(
          /sensitive|private|synthetic|card-/,
        );
      }
    },
  );
});
