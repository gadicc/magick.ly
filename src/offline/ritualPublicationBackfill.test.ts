import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  createRitualPublicationBackfillService,
  parseRitualPublicationBackfillRequest,
} from "./ritualPublicationBackfill";

vi.mock("server-only", () => ({}));

const actor = createUuidV7();
const request = {
  version: 1 as const,
  expectedActorId: actor,
  afterRitualId: null,
};
const candidate = (pendingOperationIds: string[] = []) => ({
  ritualId: createUuidV7(),
  currentRevisionId: createUuidV7(),
  currentCompiledArtifactId: createUuidV7(),
  version: 3,
  pendingOperationIds,
});
const completed = (operationId: string, ritualId: string) => ({
  ok: true as const,
  state: "completed" as const,
  replayed: false,
  receipt: {
    operationId,
    bundleId: createUuidV7(),
    ritualId,
    publishedAtMs: 1,
  },
});

describe("ritual publication backfill", () => {
  it("strictly parses its bounded cursor command", () => {
    expect(parseRitualPublicationBackfillRequest(request)).toEqual(request);
    expect(
      parseRitualPublicationBackfillRequest({ ...request, unexpected: true }),
    ).toBeNull();
  });

  it("skips a valid current bundle and publishes at most one later candidate", async () => {
    const first = candidate();
    const second = candidate();
    const operationId = createUuidV7();
    const publish = vi.fn(async (input: unknown) => {
      const value = input as { operationId: string; ritualId: string };
      return completed(value.operationId, value.ritualId);
    });
    const authorizeGlobalActor = vi.fn(async () => {});
    const service = createRitualPublicationBackfillService({
      readPage: async () => ({ candidates: [first, second], exhausted: true }),
      authorizeGlobalActor,
      hasCurrentBundle: async (value) => value.ritualId === first.ritualId,
      publish,
      createOperationId: () => operationId,
    });
    await expect(service(request)).resolves.toMatchObject({
      ok: true,
      done: false,
      cursor: second.ritualId,
      skipped: 1,
      publication: { ok: true, receipt: { operationId } },
    });
    expect(publish).toHaveBeenCalledWith(
      {
        version: 1,
        operationId,
        expectedActorId: actor,
        ritualId: second.ritualId,
        expectedRevisionId: second.currentRevisionId,
        expectedVersion: second.version,
      },
      expect.any(AbortSignal),
    );
    expect(authorizeGlobalActor).toHaveBeenCalledTimes(3);
  });

  it("resumes the one discovered unexpired intent and preserves cursor on failure", async () => {
    const operationId = createUuidV7();
    const current = candidate([operationId]);
    const service = createRitualPublicationBackfillService({
      readPage: async () => ({ candidates: [current], exhausted: true }),
      authorizeGlobalActor: async () => {},
      hasCurrentBundle: async () => false,
      publish: async (input) => {
        expect(input).toMatchObject({ operationId });
        return {
          ok: false,
          code: "BUSY",
          message:
            "This ritual publication is already being processed. Retry shortly.",
          retryable: true,
        };
      },
    });
    await expect(service(request)).resolves.toMatchObject({
      ok: false,
      code: "BUSY",
      cursor: null,
    });
  });

  it("refuses ambiguous concurrent pending intents without creating another", async () => {
    const createOperationId = vi.fn(() => createUuidV7());
    const service = createRitualPublicationBackfillService({
      readPage: async () => ({
        candidates: [candidate([createUuidV7(), createUuidV7()])],
        exhausted: true,
      }),
      authorizeGlobalActor: async () => {},
      hasCurrentBundle: async () => false,
      publish: vi.fn(),
      createOperationId,
    });
    await expect(service(request)).resolves.toMatchObject({
      ok: false,
      code: "BUSY",
    });
    expect(createOperationId).not.toHaveBeenCalled();
  });
});
