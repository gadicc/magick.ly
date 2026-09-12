import { v7, validate, version } from "uuid";

/** Generates a canonical UUIDv7 before a browser or Node operation is persisted. */
export function createUuidV7(): string {
  return v7();
}

/** Checks the UUID version and RFC variant; legacy identifiers are not UUIDs. */
export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && validate(value) && version(value) === 7;
}
