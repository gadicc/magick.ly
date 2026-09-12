/** Bundled, anonymous rituals and their display-only query keys. Database IDs are excluded. */
export const publicRitualQueryKeys = {
  neophyte: [
    "myRole",
    "candidateName",
    "candidateMotto",
    "templeName",
    "orderName",
    "witnessed",
  ],
  zelator: [
    "myRole",
    "candidateName",
    "candidateMotto",
    "templeName",
    "orderName",
    "witnessed",
  ],
  theoricus: [
    "myRole",
    "candidateMotto",
    "templeName",
    "orderName",
    "witnessed",
  ],
} as const;

export function isPublicRitualId(
  id: string,
): id is keyof typeof publicRitualQueryKeys {
  return Object.hasOwn(publicRitualQueryKeys, id);
}
