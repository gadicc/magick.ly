import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("nlopt-js");
  vi.resetModules();
});

describe("optimiser loading", () => {
  it("does not cache a failed load and recovers on the next call", async () => {
    vi.resetModules();
    const actual = await vi.importActual<{ default: object }>("nlopt-js");
    let failOnce = true;
    vi.doMock("nlopt-js", () => ({
      default: new Proxy(actual.default, {
        get(target, property, receiver) {
          if (property === "ready" && failOnce) {
            failOnce = false;
            return Promise.reject(new Error("wasm unavailable"));
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    }));
    const { optimizeSigilPoints, sigilPoints } = await import(
      "./roseSigilGeometry"
    );
    await expect(optimizeSigilPoints(sigilPoints("אב"))).rejects.toThrow(
      "wasm unavailable",
    );
    await expect(optimizeSigilPoints(sigilPoints("אב"))).resolves.toHaveLength(
      2,
    );
  });
});
