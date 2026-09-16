import { describe, expect, it } from "vitest";
import { readFieldPath } from "./fieldPath";

describe("field path lookup", () => {
  const record = { name: { en: "Crown", roman: "Keter" }, index: 1 };

  it("reads dotted paths and misses quietly", () => {
    expect(readFieldPath(record, "name.en")).toBe("Crown");
    expect(readFieldPath(record, "index")).toBe(1);
    expect(readFieldPath(record, "name.missing")).toBeUndefined();
    expect(readFieldPath(record, "")).toBeUndefined();
  });

  it("degrades malformed query-string paths to undefined", () => {
    for (const path of ["name[", "name[en]", "name.en]"])
      expect(readFieldPath(record, path)).toBeUndefined();
  });
});
