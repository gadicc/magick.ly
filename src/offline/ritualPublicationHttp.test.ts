import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { failedRitualPublicationBackfill } from "./ritualPublicationBackfill";
import { failedRitualPublication } from "./ritualPublicationContract";
import {
  createRitualPublicationBackfillHttpHandler,
  createRitualPublicationHttpHandler,
} from "./ritualPublicationHttp";

vi.mock("server-only", () => ({}));

const command = {
  version: 1,
  operationId: createUuidV7(),
  expectedActorId: createUuidV7(),
  ritualId: createUuidV7(),
  expectedRevisionId: createUuidV7(),
  expectedVersion: 2,
};
const request = (body: string, headers: HeadersInit = {}) =>
  new Request("https://magick.ly/api/rituals/publication", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

describe("ritual publication HTTP boundary", () => {
  it("passes a bounded JSON command and request cancellation to the service", async () => {
    const publish = vi.fn(async () => failedRitualPublication("BUSY"));
    const response = await createRitualPublicationHttpHandler({ publish })(
      request(JSON.stringify(command)),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual(failedRitualPublication("BUSY"));
    expect(publish).toHaveBeenCalledWith(command, expect.any(AbortSignal));
  });

  it.each([
    new Request("https://magick.ly/api/rituals/publication"),
    new Request("https://magick.ly/api/rituals/publication", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
    request("{"),
    request(JSON.stringify(command), { "content-length": "999999" }),
  ])("rejects malformed transport input before service work", async (input) => {
    const publish = vi.fn();
    const response = await createRitualPublicationHttpHandler({ publish })(
      input,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      failedRitualPublication("INVALID_REQUEST"),
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it("replaces thrown diagnostics with one safe unavailable result", async () => {
    const response = await createRitualPublicationHttpHandler({
      publish: async () => {
        throw new Error("provider token raw diagnostic");
      },
    })(request(JSON.stringify(command)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(
      failedRitualPublication("UNAVAILABLE"),
    );
  });

  it("keeps the maintenance backfill boundary bounded and diagnostic-free", async () => {
    const backfillCommand = {
      version: 1,
      expectedActorId: command.expectedActorId,
      afterRitualId: null,
    };
    const backfill = vi.fn(async () =>
      failedRitualPublicationBackfill("BUSY", null),
    );
    const response = await createRitualPublicationBackfillHttpHandler({
      backfill,
    })(request(JSON.stringify(backfillCommand)));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(
      failedRitualPublicationBackfill("BUSY", null),
    );
    expect(backfill).toHaveBeenCalledWith(
      backfillCommand,
      expect.any(AbortSignal),
    );
  });
});
