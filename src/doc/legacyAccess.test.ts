import { ObjectId } from "bson";
import { ObjectId as MongoObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { getRitualAccess } from "./access";
import {
  legacyRitualId,
  legacyRitualPolicy,
  legacyRitualPrincipal,
  legacyRitualRevision,
} from "./legacyAccess";

const creatorId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const userId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const docId = "cccccccccccccccccccccccc";
const templeId = "dddddddddddddddddddddddd";
const groupId = "eeeeeeeeeeeeeeeeeeeeeeee";
const revisionId = "ffffffffffffffffffffffff";
const rawDoc = { _id: new ObjectId(docId), userId: new ObjectId(creatorId) };
const rawUser = { _id: new ObjectId(userId) };
const rawMembership = {
  userId: new ObjectId(userId),
  templeId: new ObjectId(templeId),
  grade: 0,
};

describe("explicit legacy ObjectId boundaries", () => {
  it("compares actual BSON/driver ObjectIds with hex strings at identity fields", () => {
    expect(legacyRitualId(new ObjectId(userId))).toBe(userId);
    expect(legacyRitualId(new MongoObjectId(userId))).toBe(userId);
    expect(legacyRitualId(userId.toUpperCase())).toBe(userId);
  });
  it.each([
    null,
    undefined,
    "",
    "none",
    "public",
    " reader ",
    10,
    [],
    "a".repeat(23),
    "g".repeat(24),
  ])("rejects malformed IDs %j", (id) => {
    expect(legacyRitualId(id)).toBeNull();
  });
  it("does not stringify arbitrary objects or trust ObjectId-shaped claims", () => {
    const toString = vi.fn(() => userId);
    const toHexString = vi.fn(() => userId);
    expect(legacyRitualId({ toString })).toBeNull();
    expect(legacyRitualId({ _bsontype: "ObjectId", toHexString })).toBeNull();
    expect(toString).not.toHaveBeenCalled();
    expect(toHexString).not.toHaveBeenCalled();
  });
  it("does not silently merge future UUID identifiers with Mongo identities", () => {
    expect(legacyRitualId("01993cf8-92d0-7000-8000-000000000001")).toBeNull();
  });
});

describe("legacy policy normalization", () => {
  it("retains public/group semantics despite unused minGrade left by the old UI", () => {
    expect(legacyRitualPolicy({ ...rawDoc, minGrade: 0 })).toEqual({
      id: docId,
      creatorId,
      scope: { kind: "public" },
    });
    expect(
      legacyRitualPolicy({
        ...rawDoc,
        groupId: new ObjectId(groupId),
        minGrade: 2,
      })?.scope,
    ).toEqual({ kind: "group", groupId });
  });
  it("keeps grade zero and defaults only an absent temple minimum to zero", () => {
    expect(
      legacyRitualPolicy({ ...rawDoc, templeId, minGrade: 0 })?.scope,
    ).toEqual({ kind: "temple", templeId, minGrade: 0 });
    expect(legacyRitualPolicy({ ...rawDoc, templeId })?.scope).toEqual({
      kind: "temple",
      templeId,
      minGrade: 0,
    });
  });
  it.each(["0", null, -1, 0.1, NaN, Infinity])(
    "does not coerce invalid temple minimum %j",
    (minGrade) => {
      expect(legacyRitualPolicy({ ...rawDoc, templeId, minGrade })).toBeNull();
    },
  );
  it.each([
    { ...rawDoc, groupId, templeId },
    { ...rawDoc, groupId: null },
    { ...rawDoc, templeId: null },
    { ...rawDoc, templeId: "none" },
    { ...rawDoc, userId: {} },
    { ...rawDoc, _id: {} },
    { ...rawDoc, groupId: "" },
    { ...rawDoc, templeId: "" },
  ])("fails closed for malformed identity or scope %j", (row) => {
    const normalized = legacyRitualPolicy(row);
    expect(normalized).toBeNull();
    expect(
      getRitualAccess(
        normalized,
        legacyRitualPrincipal(userId, { ...rawUser, admin: true }, []),
      ),
    ).toEqual({ read: false, edit: false, readSourceHistory: false });
  });
});

describe("legacy current principal normalization", () => {
  it("normalizes explicit group/temple reference fields before equality checks", () => {
    const principal = legacyRitualPrincipal(
      userId.toUpperCase(),
      {
        ...rawUser,
        groupIds: [new ObjectId(groupId)],
        groupAdminIds: [groupId.toUpperCase()],
      },
      [
        {
          ...rawMembership,
          userId: userId.toUpperCase(),
          templeId: templeId.toUpperCase(),
        },
      ],
    );
    expect(principal).toEqual({
      userId,
      globalAdmin: false,
      groupIds: [groupId],
      groupAdminIds: [groupId],
      templeMemberships: [{ templeId, grade: 0, admin: false }],
    });
    const doc = legacyRitualPolicy({
      ...rawDoc,
      templeId: new ObjectId(templeId),
      minGrade: 0,
    });
    expect(getRitualAccess(doc, principal)).toEqual({
      read: true,
      edit: false,
      readSourceHistory: false,
    });
  });
  it("does not take user identity or memberships from a different authenticated user", () => {
    expect(legacyRitualPrincipal(creatorId, rawUser, [])).toBeNull();
    expect(legacyRitualPrincipal(null, rawUser, [])).toBeNull();
    expect(legacyRitualPrincipal(userId, null, [])).toBeNull();
    expect(
      legacyRitualPrincipal(userId, rawUser, [
        { ...rawMembership, userId: creatorId },
        { ...rawMembership, templeId: {} },
      ])?.templeMemberships,
    ).toEqual([]);
  });
  it("accepts only boolean privileges and finite integer grades, while ignoring invalid references", () => {
    expect(
      legacyRitualPrincipal(
        userId,
        {
          ...rawUser,
          admin: "true",
          groupIds: [groupId, {}],
          groupAdminIds: "all",
        },
        [{ ...rawMembership, grade: "0", admin: "true" }],
      ),
    ).toEqual({
      userId,
      globalAdmin: false,
      groupIds: [groupId],
      groupAdminIds: [],
      templeMemberships: [{ templeId, grade: null, admin: false }],
    });
  });
  it("keeps explicit temple admin access despite missing grade", () => {
    const principal = legacyRitualPrincipal(userId, rawUser, [
      { ...rawMembership, grade: undefined, admin: true },
    ]);
    expect(
      getRitualAccess(
        legacyRitualPolicy({ ...rawDoc, templeId, minGrade: 2 }),
        principal,
      ),
    ).toEqual({ read: true, edit: true, readSourceHistory: true });
  });
});

describe("legacy revision identity", () => {
  const row = {
    _id: new ObjectId(revisionId),
    docId: new ObjectId(docId),
    userId: userId.toUpperCase(),
    createdAt: new Date(1234),
  };
  it("binds the exact parent and author through known identity fields", () => {
    expect(legacyRitualRevision(row)).toEqual({
      id: revisionId,
      ritualId: docId,
      authorId: userId,
      createdAt: 1234,
    });
  });
  it.each([
    { ...row, _id: null },
    { ...row, docId: {} },
    { ...row, userId: {} },
    { ...row, createdAt: new Date(NaN) },
    { ...row, createdAt: "1970-01-01" },
  ])("rejects invalid revision identity %j", (invalid) =>
    expect(legacyRitualRevision(invalid)).toBeNull(),
  );
});

it("keeps scoped access with missing or explicitly known-orphan creators", () => {
  const principal = legacyRitualPrincipal(userId, rawUser, [
    { ...rawMembership, admin: true },
  ]);
  for (const row of [
    { ...rawDoc, userId: undefined },
    { ...rawDoc, userId: null },
  ]) {
    const policy = legacyRitualPolicy({ ...row, templeId, minGrade: 2 });
    expect(policy?.creatorId).toBeNull();
    expect(getRitualAccess(policy, principal)).toEqual({
      read: true,
      edit: true,
      readSourceHistory: true,
    });
  }
  const orphan = { ...rawDoc, templeId, minGrade: 2 };
  const policy = legacyRitualPolicy(orphan, { knownOrphanCreator: true });
  expect(policy?.creatorId).toBeNull();
  expect(orphan.userId.toHexString()).toBe(creatorId);
  expect(getRitualAccess(policy, principal).edit).toBe(true);
  expect(
    legacyRitualPolicy({ ...orphan, userId: {} }, { knownOrphanCreator: true }),
  ).toBeNull();
});
