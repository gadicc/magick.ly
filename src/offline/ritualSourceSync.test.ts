// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { syncOfflineRitualSource } from "./ritualSourceSync";

const ownerId = createUuidV7();
const ritualId = createUuidV7();
const revisionId = createUuidV7();
const account = { ownerId, epoch: createUuidV7() };
const pending = {
  ownerId,
  ritualId,
  accountEpoch: account.epoch,
  requestId: createUuidV7(),
  startedAtMs: 100,
};

function response(body: unknown) {
  const serialized = JSON.stringify(body);
  const value = new Response(serialized, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "content-length": String(new TextEncoder().encode(serialized).byteLength),
    },
  });
  Object.defineProperty(value, "url", {
    value: `${location.origin}/api/rituals/source`,
  });
  return value;
}

function granted(requestId = pending.requestId) {
  return {
    version: 1,
    requestId,
    ownerId,
    ritualId,
    kind: "granted",
    grant: {
      version: 1,
      leaseId: createUuidV7(),
      ownerId,
      ritualId,
      checkedAtMs: 100,
      respondedAtMs: 101,
      expiresAtMs: 200,
      sourceEdit: true,
    },
    rendered: { kind: "temporarily-unavailable" },
    editor: { currentRevisionId: revisionId, parentVersion: 4 },
  } as const;
}

function fixture() {
  const abort = new AbortController();
  const repository = {
    beginCheck: vi.fn().mockResolvedValue(pending),
    acceptPermission: vi.fn().mockResolvedValue("accepted"),
    installSource: vi.fn().mockResolvedValue(true),
  };
  const coordinator = {
    currentPermissionCheck: vi.fn(() => true),
    changed: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn(),
  };
  const registration = {
    beginPermissionCheck: vi.fn(() => ({ account, signal: abort.signal })),
  };
  return { abort, repository, coordinator, registration };
}

it("installs one source snapshot only from its matching fresh source envelope", async () => {
  const f = fixture();
  const permission = granted();
  const fetcher = vi.fn().mockResolvedValue(
    response({
      version: 1,
      requestId: pending.requestId,
      ownerId,
      ritualId,
      permission,
      source: {
        title: "Protected title",
        revisionId,
        parentVersion: 4,
        source: "p Exact source",
      },
    }),
  );
  const installed = vi.fn();
  await expect(
    syncOfflineRitualSource(
      f as never,
      f.registration,
      ritualId,
      fetcher,
      installed,
    ),
  ).resolves.toMatchObject({
    title: "Protected title",
    snapshot: {
      ownerId,
      ritualId,
      revisionId,
      parentVersion: 4,
      title: "Protected title",
      source: "p Exact source",
    },
  });
  expect(f.repository.acceptPermission).toHaveBeenCalledWith(
    pending,
    permission,
    undefined,
    { revisionId, parentVersion: 4 },
  );
  expect(f.repository.installSource).toHaveBeenCalledOnce();
  expect(installed).toHaveBeenCalledOnce();
  expect(f.coordinator.changed).toHaveBeenCalledTimes(2);
  expect(f.coordinator.finish).toHaveBeenCalledOnce();
});

it("applies the latest denial but never installs source bytes", async () => {
  const f = fixture();
  const denial = {
    version: 1,
    requestId: pending.requestId,
    ownerId,
    ritualId,
    kind: "denied",
  } as const;
  const fetcher = vi.fn().mockResolvedValue(
    response({
      version: 1,
      requestId: pending.requestId,
      ownerId,
      ritualId,
      permission: denial,
      source: null,
    }),
  );
  await expect(
    syncOfflineRitualSource(f as never, f.registration, ritualId, fetcher),
  ).resolves.toBeNull();
  expect(f.repository.acceptPermission).toHaveBeenCalledWith(
    pending,
    denial,
    undefined,
    undefined,
  );
  expect(f.repository.installSource).not.toHaveBeenCalled();
  expect(f.coordinator.changed).toHaveBeenCalledOnce();
});

it("drops a response when the coordinator identity changed during fetch", async () => {
  const f = fixture();
  f.coordinator.currentPermissionCheck.mockReturnValue(false);
  f.abort.abort();
  const fetcher = vi.fn().mockResolvedValue(response({}));
  const interrupted = vi.fn();
  await syncOfflineRitualSource(
    f as never,
    f.registration,
    ritualId,
    fetcher,
    undefined,
    interrupted,
  );
  expect(f.repository.acceptPermission).not.toHaveBeenCalled();
  expect(f.repository.installSource).not.toHaveBeenCalled();
  expect(interrupted).toHaveBeenCalledOnce();
});

it("does not report its own accepted permission change as an interruption", async () => {
  const f = fixture();
  f.coordinator.changed.mockImplementation(async () => {
    f.abort.abort();
  });
  const permission = granted();
  const fetcher = vi.fn().mockResolvedValue(
    response({
      version: 1,
      requestId: pending.requestId,
      ownerId,
      ritualId,
      permission,
      source: {
        title: "Protected title",
        revisionId,
        parentVersion: 4,
        source: "p Exact source",
      },
    }),
  );
  const interrupted = vi.fn();
  await syncOfflineRitualSource(
    f as never,
    f.registration,
    ritualId,
    fetcher,
    undefined,
    interrupted,
  );
  expect(f.repository.acceptPermission).toHaveBeenCalledOnce();
  expect(interrupted).not.toHaveBeenCalled();
});
