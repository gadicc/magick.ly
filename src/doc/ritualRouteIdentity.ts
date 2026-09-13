import { isUuidV7 } from "../lib/ids";

const uuidV7 = (value: string): boolean => isUuidV7(value);

export type RitualRouteIdentity =
  | { kind: "canonical"; ritualId: string }
  | { kind: "legacy-objectid"; legacyId: string };

/** Only canonical SQL IDs and the audited Mongo docs ObjectId route survive cutover. */
export function parseRitualRouteIdentity(
  value: unknown,
): RitualRouteIdentity | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    value.includes("\0") ||
    !value.isWellFormed()
  )
    return null;
  if (uuidV7(value))
    return value === value.toLowerCase()
      ? { kind: "canonical", ritualId: value }
      : null;
  return /^[0-9a-f]{24}$/i.test(value)
    ? { kind: "legacy-objectid", legacyId: value.toLowerCase() }
    : null;
}

export function ritualRouteIdFromPath(pathname: string): string | null {
  const match = /^\/doc\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
