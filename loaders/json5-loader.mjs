// Turbopack loader for *.json5 (see `turbopack.rules` in next.config.ts).
// Turbopack's own JSON parser rejects JSON5, and webpack parses it directly.
import JSON5 from "json5";

/** Returns strict JSON for a JSON5 source. */
export default function json5Loader(source) {
  return JSON.stringify(JSON5.parse(source));
}
