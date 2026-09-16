import { getProperty } from "dot-prop";

/**
 * Reads a dotted field path such as `name.en` from a data record.
 *
 * dot-prop 10 throws on malformed bracket paths. Field paths arrive from the
 * query string, so an unusable path yields `undefined` and a blank label
 * instead of a render error.
 */
export function readFieldPath(
  source: Parameters<typeof getProperty>[0],
  path: string,
): unknown {
  try {
    return getProperty(source, path);
  } catch {
    return undefined;
  }
}
