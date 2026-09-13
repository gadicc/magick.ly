import { describe, expect, it } from "vitest";
import { safeAuthCallbackURL } from "./callbackURL";

describe("sign-in callback paths", () => {
  it.each([
    "/",
    "/admin",
    "/temples/join/example/code",
    "/temples/join/example/two%20words",
    "/doc/neophyte?myRole=hierophant#Opening",
  ])("retains application path %s", (path) => {
    expect(safeAuthCallbackURL(path)).toBe(path);
  });
  it.each([
    undefined,
    ["/admin"],
    "https://outside.example",
    "//outside.example",
    "/%2foutside.example",
    "/\\outside.example",
    "/%5coutside.example",
    "/admin%0aLocation:test",
    "/%",
    "/api/auth/sign-out",
    "/%61pi/auth/sign-out",
  ])("rejects an external, malformed or API callback", (value) => {
    expect(safeAuthCallbackURL(value)).toBe("/");
  });
});
