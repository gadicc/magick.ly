import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "@/lib/ids";
import type { StudyServerSnapshot } from "@/study/reviewContract";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn() }));
vi.mock("@/study/sqlRuntime", () => ({ sqlStudyService: mocks }));

const actorId = createUuidV7();
const snapshot: StudyServerSnapshot = {
  _id: createUuidV7(),
  userId: actorId,
  setId: "synthetic",
  correct: 3,
  incorrect: 1,
  time: 4_000,
  dueDate: new Date("2026-09-13T12:00:00Z"),
  version: 4,
  cards: Object.create(null),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ ok: true, snapshots: [snapshot] });
  mocks.review.mockResolvedValue({
    ok: true,
    eventId: createUuidV7(),
    replayed: false,
    acceptedVersion: 4,
    snapshot,
  });
});

describe("study HTTP boundary", () => {
  it("returns no-store wire snapshots and forwards only the query key", async () => {
    const response = await GET(
      new Request("https://example.test/api/study?setId=synthetic"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(mocks.list).toHaveBeenCalledWith("synthetic");
    expect(await response.json()).toMatchObject({
      ok: true,
      snapshots: [
        {
          id: snapshot._id,
          userId: actorId,
          setId: "synthetic",
          dueAtMs: snapshot.dueDate.getTime(),
          version: 4,
        },
      ],
    });
  });

  it("passes an immutable JSON command to the SQL service and maps auth failure", async () => {
    const command = { version: 1, eventId: createUuidV7() };
    const accepted = await POST(
      new Request("https://example.test/api/study", {
        method: "POST",
        body: JSON.stringify(command),
      }),
    );
    expect(accepted.status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith(command);

    mocks.review.mockResolvedValue({
      ok: false,
      code: "NOT_AUTHENTICATED",
      message: "Sign in.",
      retryable: false,
    });
    const rejected = await POST(
      new Request("https://example.test/api/study", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(mocks.review).toHaveBeenLastCalledWith(null);
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("cache-control")).toContain("no-store");
  });
});
