import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { createSqlRitualEditorHttpHandlers } from "./sqlEditorHttp";
import { SQL_RITUAL_WRITE_MESSAGES } from "./sqlWriteContract";

vi.mock("server-only", () => ({}));

const actorId = createUuidV7();
const ritualId = createUuidV7();
const services = {
  source: vi.fn(),
  write: vi.fn(),
  creationOptions: vi.fn(),
};
const handlers = createSqlRitualEditorHttpHandlers(services);

beforeEach(() => {
  vi.clearAllMocks();
  services.creationOptions.mockResolvedValue({
    version: 1,
    ownerId: actorId,
    public: false,
    groups: [],
    temples: [],
  });
});

describe("SQL editor HTTP boundary", () => {
  it("uses a private no-store JSON response for fresh creation options", async () => {
    const response = await handlers.creationOptions(
      new Request("https://example.test/api/rituals/creation-options"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toMatchObject({ ownerId: actorId });
  });

  it("rejects query-bearing option reads and non-JSON source requests", async () => {
    expect(
      (
        await handlers.creationOptions(
          new Request(
            "https://example.test/api/rituals/creation-options?cached=true",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handlers.source(
          new Request("https://example.test/api/rituals/source", {
            method: "POST",
            body: "{}",
            headers: { "content-type": "text/plain" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(services.source).not.toHaveBeenCalled();
  });

  it("bounds write failures to the stable unavailable contract", async () => {
    services.write.mockRejectedValue(new Error("private database details"));
    const response = await handlers.write(
      new Request("https://example.test/api/rituals/write", {
        method: "POST",
        body: JSON.stringify({ ritualId }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: SQL_RITUAL_WRITE_MESSAGES.UNAVAILABLE,
      retryable: true,
    });
  });

  it("rejects a declared oversized write without invoking SQL", async () => {
    const response = await handlers.write(
      new Request("https://example.test/api/rituals/write", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          "content-length": String(2 * 1024 * 1024),
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(services.write).not.toHaveBeenCalled();
  });
});
