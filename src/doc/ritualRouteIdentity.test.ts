import { expect, it } from "vitest";
import {
  parseRitualRouteIdentity,
  ritualRouteIdFromPath,
} from "./ritualRouteIdentity";

const UUID = "019947c5-abcd-7000-8000-000000000001";

it("accepts canonical UUIDv7 and normalizes only the audited ObjectId alias", () => {
  expect(parseRitualRouteIdentity(UUID)).toEqual({
    kind: "canonical",
    ritualId: UUID,
  });
  expect(parseRitualRouteIdentity("ABCDEFABCDEFABCDEFABCDEF")).toEqual({
    kind: "legacy-objectid",
    legacyId: "abcdefabcdefabcdefabcdef",
  });
  expect(parseRitualRouteIdentity(UUID.toUpperCase())).toBeNull();
  expect(parseRitualRouteIdentity("arbitrary-string-alias")).toBeNull();
});

it("extracts only a single decoded doc route segment", () => {
  expect(ritualRouteIdFromPath(`/doc/${UUID}`)).toBe(UUID);
  expect(ritualRouteIdFromPath(`/doc/${UUID}/`)).toBe(UUID);
  expect(ritualRouteIdFromPath(`/doc/${UUID}/edit`)).toBeNull();
  expect(ritualRouteIdFromPath("/offline/ritual")).toBeNull();
  expect(ritualRouteIdFromPath("/doc/%zz")).toBeNull();
});
