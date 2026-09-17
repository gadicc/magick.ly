// Vitest stand-in for `next/font/local`, whose call Next compiles away; the
// package's runtime module is empty. See `resolve.alias` in vitest.config.mts.
export default function localFont(_options: unknown) {
  return { className: "", style: { fontFamily: "LocalFont" } };
}
