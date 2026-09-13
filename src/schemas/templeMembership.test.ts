import { ObjectId } from "bson";
import dayjs from "dayjs";
import { safeParse } from "valibot";
import { describe, expect, it } from "vitest";
import {
  templeMembershipClientSchema,
  templeMembershipServerSchema,
} from "./templeMembership";

const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const templeId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const membershipId = "cccccccccccccccccccccccc";
const client = {
  _id: membershipId,
  userId,
  templeId,
  grade: 0,
  admin: false,
  addedAt: new Date("2024-01-01"),
};
const server = {
  ...client,
  _id: new ObjectId(membershipId),
  userId: new ObjectId(userId),
  templeId: new ObjectId(templeId),
};

describe.each([
  ["client", templeMembershipClientSchema, client],
  ["server", templeMembershipServerSchema, server],
] as const)("%s membership date validation", (_name, schema, fields) => {
  it("normalizes a numeric grade from a recovered form and rejects invalid grades", () => {
    const accepted = safeParse(schema, { ...fields, grade: "3" });
    expect(accepted.success && accepted.output.grade).toBe(3);
    for (const grade of ["-1", "1.5", "not a grade", -1, 1.5])
      expect(safeParse(schema, { ...fields, grade }).success).toBe(false);
  });
  it.each([undefined, null, new Date("2024-01-01"), dayjs("2024-01-01")])(
    "accepts an optional or valid memberSince %s",
    (memberSince) => {
      expect(safeParse(schema, { ...fields, memberSince }).success).toBe(true);
    },
  );
  it.each([
    new Date(NaN),
    dayjs("invalid"),
    "2024-01-01",
    { isValid: () => true },
  ])("rejects invalid/untyped memberSince %s", (memberSince) => {
    const result = safeParse(schema, { ...fields, memberSince });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.issues[0].message).toBe("Enter a valid date.");
  });
});
