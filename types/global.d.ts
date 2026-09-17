declare module "*.json5" {
  const value: unknown;
  export default value;
}

/** Imported `with { type: "text" }`; see next.config.ts. */
declare module "*.jade" {
  const source: string;
  export default source;
}
