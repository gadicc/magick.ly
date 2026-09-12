import { describe, expect, it } from "vitest";
import {
  applyPermissionReply,
  emptyAuthorization,
  inspectOfflineAuthorization,
  type OfflineAccount,
  type OfflineGrantV1,
  type PendingPermissionCheck,
  type PermissionReply,
  OFFLINE_AUTHORIZATION_WINDOW_MS as WINDOW,
} from "./lease";

const ownerId = "01993000-0000-7000-8000-000000000001";
const otherOwnerId = "01993000-0000-7000-8000-000000000002";
const ritualId = "01993000-0000-7000-8000-000000000010";
const requestId = "01993000-0000-7000-8000-000000000020";
const nextRequestId = "01993000-0000-7000-8000-000000000021";
const epoch = "01993000-0000-7000-8000-000000000030";
const nextEpoch = "01993000-0000-7000-8000-000000000031";
const serverTime = 2_000_000_000_000;
const start = serverTime - 5000;
const account: OfflineAccount = { ownerId, epoch };
const pending: PendingPermissionCheck = {
  requestId,
  ownerId,
  ritualId,
  accountEpoch: epoch,
  startedAtMs: start,
};
const grant: OfflineGrantV1 = {
  version: 1,
  leaseId: "01993000-0000-7000-8000-000000000040",
  ownerId,
  ritualId,
  checkedAtMs: serverTime,
  respondedAtMs: serverTime,
  expiresAtMs: serverTime + WINDOW,
  sourceEdit: true,
};
const reply: PermissionReply = {
  requestId,
  ownerId,
  ritualId,
  kind: "granted",
  grant,
};
const empty = () => emptyAuthorization(account, ritualId);
const accept = () =>
  applyPermissionReply(
    empty(),
    pending,
    reply,
    account,
    requestId,
    start + 6000,
  ).authorization;

describe("renewable 14-day ritual authorization", () => {
  it("starts the local maximum at the request start, not download completion", () => {
    const state = accept();
    expect(state.localDeadlineMs).toBe(start + WINDOW);
    expect(state.localDeadlineMs).toBeLessThan(grant.expiresAtMs);
    expect(state.grant).toEqual(grant);
    expect(
      inspectOfflineAuthorization(state, account, start + WINDOW - 1),
    ).toMatchObject({ read: true, sourceEdit: true });
  });

  it("does not renew on local reads and latches expiry before the clock can move back", () => {
    const state = accept();
    const read = inspectOfflineAuthorization(
      state,
      account,
      start + WINDOW - 1,
    );
    expect(read.authorization?.localDeadlineMs).toBe(state.localDeadlineMs);
    expect(read.authorization?.grant).toEqual(state.grant);
    const expired = inspectOfflineAuthorization(
      read.authorization,
      account,
      start + WINDOW,
    );
    expect(expired).toMatchObject({
      read: false,
      sourceEdit: false,
      purgeDownloads: true,
      reason: "expired",
    });
    expect(
      inspectOfflineAuthorization(expired.authorization, account, start + 1),
    ).toMatchObject({ read: false, reason: "expired" });
  });

  it("locks on observed clock rollback across a cold-start state read", () => {
    const observed = inspectOfflineAuthorization(
      accept(),
      account,
      start + WINDOW / 2,
    ).authorization;
    const coldStart = JSON.parse(JSON.stringify(observed));
    const rolledBack = inspectOfflineAuthorization(
      coldStart,
      account,
      start + 10_000,
    );
    expect(rolledBack).toMatchObject({
      read: false,
      sourceEdit: false,
      purgeDownloads: true,
      reason: "clock-rollback",
    });
    expect(
      inspectOfflineAuthorization(
        rolledBack.authorization,
        account,
        start + WINDOW / 2,
      ),
    ).toMatchObject({ read: false, reason: "clock-rollback" });
  });

  it("requires a new successful server permission check to clear a persisted clock lock", () => {
    const locked = inspectOfflineAuthorization(
      accept(),
      account,
      start - 1,
    ).authorization;
    const nextCheck = {
      ...pending,
      requestId: nextRequestId,
      startedAtMs: start - 2000,
    };
    const checked = applyPermissionReply(
      locked,
      nextCheck,
      { ...reply, requestId: nextRequestId },
      account,
      nextRequestId,
      start - 1000,
    );
    expect(
      inspectOfflineAuthorization(checked.authorization, account, start),
    ).toMatchObject({ read: true, sourceEdit: true });
    expect(checked.authorization.localDeadlineMs).toBe(start - 2000 + WINDOW);
  });

  it.each(["authentication-required", "temporarily-unavailable"] as const)(
    "does not revoke or renew an existing grant on %s",
    (kind) => {
      const previous = accept();
      const result = applyPermissionReply(
        previous,
        pending,
        { ...reply, kind },
        account,
        requestId,
        start + 20_000,
      );
      expect(result).toEqual({
        authorization: previous,
        outcome: "paused",
        purgeDownloads: false,
        purgeSourceSnapshots: false,
        lockDrafts: false,
      });
      expect(
        inspectOfflineAuthorization(
          result.authorization,
          account,
          start + 20_000,
        ).read,
      ).toBe(true);
    },
  );

  it("removes downloaded data and locks unique recovery after confirmed same-account denial", () => {
    const result = applyPermissionReply(
      accept(),
      pending,
      { ...reply, kind: "denied" },
      account,
      requestId,
      start + 20_000,
    );
    expect(result).toMatchObject({
      outcome: "accepted",
      purgeDownloads: true,
      purgeSourceSnapshots: true,
      lockDrafts: true,
    });
    expect(
      inspectOfflineAuthorization(
        result.authorization,
        account,
        start + 20_000,
      ),
    ).toMatchObject({ read: false, sourceEdit: false, reason: "revoked" });
    expect(result).not.toHaveProperty("deleteDrafts");
  });

  it("keeps rendered read access but removes source and locks drafts on an edit-right downgrade", () => {
    const result = applyPermissionReply(
      accept(),
      pending,
      { ...reply, grant: { ...grant, sourceEdit: false } },
      account,
      requestId,
      start + 20_000,
    );
    expect(result).toMatchObject({
      outcome: "accepted",
      purgeDownloads: false,
      purgeSourceSnapshots: true,
      lockDrafts: true,
    });
    expect(
      inspectOfflineAuthorization(
        result.authorization,
        account,
        start + 20_001,
      ),
    ).toMatchObject({ read: true, sourceEdit: false });
  });

  it.each([
    null,
    { ownerId: otherOwnerId, epoch },
    { ownerId, epoch: nextEpoch },
  ])(
    "ignores late replies after sign-out/account replacement %j",
    (current) => {
      const previous = accept();
      for (const kind of ["granted", "denied"] as const) {
        expect(
          applyPermissionReply(
            previous,
            pending,
            { ...reply, kind },
            current,
            requestId,
            start + 20_000,
          ),
        ).toMatchObject({
          authorization: previous,
          outcome: "ignored",
          purgeDownloads: false,
        });
      }
      expect(
        inspectOfflineAuthorization(previous, current, start + 20_000),
      ).toMatchObject({ read: false, sourceEdit: false });
    },
  );

  it("does not let an older grant overwrite a newer denial", () => {
    const denied = applyPermissionReply(
      accept(),
      { ...pending, requestId: nextRequestId },
      { ...reply, requestId: nextRequestId, kind: "denied" },
      account,
      nextRequestId,
      start + 20_000,
    ).authorization;
    const late = applyPermissionReply(
      denied,
      pending,
      reply,
      account,
      nextRequestId,
      start + 30_000,
    );
    expect(late.outcome).toBe("ignored");
    expect(late.authorization).toBe(denied);
  });

  it.each([
    { requestId: nextRequestId },
    { ownerId: otherOwnerId },
    { ritualId: "01993000-0000-7000-8000-000000000011" },
  ])("ignores replies bound to another request/account/ritual %j", (change) => {
    expect(
      applyPermissionReply(
        accept(),
        pending,
        { ...reply, ...change },
        account,
        requestId,
        start + 20_000,
      ),
    ).toMatchObject({ outcome: "ignored", purgeDownloads: false });
  });

  it.each([
    { version: 2 },
    { leaseId: "000000000000000000000001" },
    { ownerId: otherOwnerId },
    { ritualId: ownerId },
    { sourceEdit: "true" },
    { checkedAtMs: NaN },
    { respondedAtMs: serverTime - 1 },
    { respondedAtMs: serverTime + WINDOW },
    { expiresAtMs: Infinity },
    { expiresAtMs: serverTime },
    { expiresAtMs: serverTime + WINDOW + 1 },
  ])("does not renew malformed or overlong grants %j", (change) => {
    const previous = accept();
    const badReply = {
      ...reply,
      grant: { ...grant, ...change },
    } as PermissionReply;
    expect(
      applyPermissionReply(
        previous,
        pending,
        badReply,
        account,
        requestId,
        start + 20_000,
      ),
    ).toMatchObject({
      authorization: previous,
      outcome: "invalid",
      purgeDownloads: false,
    });
  });

  it("refuses expired responses and clock rollback during a check", () => {
    for (const time of [start - 1, start + WINDOW]) {
      expect(
        applyPermissionReply(
          accept(),
          pending,
          reply,
          account,
          requestId,
          time,
        ),
      ).toMatchObject({ purgeDownloads: true, lockDrafts: true });
    }
  });

  it("does not grant authority to legacy cache data or corrupt persisted lease identities", () => {
    expect(inspectOfflineAuthorization(empty(), account, start)).toMatchObject({
      read: false,
      reason: "needs-check",
    });
    const state = accept();
    for (const changed of [
      { ...state, localDeadlineMs: start + WINDOW * 10 },
      { ...state, grant: { ...grant, ownerId: otherOwnerId } },
      { ...state, grant: { ...grant, version: 2 } },
    ]) {
      expect(
        inspectOfflineAuthorization(
          changed as typeof state,
          account,
          start + 20_000,
        ),
      ).toMatchObject({
        read: false,
        sourceEdit: false,
        reason: "needs-check",
      });
    }
  });
});

it("deducts server preparation time instead of restarting 14 days on receipt", () => {
  const lateReply = {
    ...reply,
    grant: { ...grant, respondedAtMs: serverTime + WINDOW / 2 },
  } as PermissionReply;
  const result = applyPermissionReply(
    empty(),
    pending,
    lateReply,
    account,
    requestId,
    start + 6000,
  );
  expect(result.authorization.localDeadlineMs).toBe(start + WINDOW / 2);
  expect(
    inspectOfflineAuthorization(
      result.authorization,
      account,
      start + WINDOW / 2,
    ),
  ).toMatchObject({ read: false, reason: "expired" });
});

it("requires an online check for a missing stored authorization and accepts a fresh grant into it", () => {
  expect(inspectOfflineAuthorization(null, account, start)).toMatchObject({
    read: false,
    sourceEdit: false,
    reason: "needs-check",
  });
  const fresh = applyPermissionReply(
    null,
    pending,
    reply,
    account,
    requestId,
    start + 6000,
  );
  expect(fresh.outcome).toBe("accepted");
  expect(
    inspectOfflineAuthorization(fresh.authorization, account, start + 7000),
  ).toMatchObject({ read: true });
});

it("fails closed on corrupt persisted timing/capability fields without deleting unique recovery", () => {
  const previous = accept();
  for (const corrupt of [
    { ...previous, localStartedAtMs: null },
    { ...previous, localDeadlineMs: Infinity },
    { ...previous, lastObservedAtMs: NaN },
    { ...previous, lastObservedAtMs: start - 1 },
    { ...previous, grant: { ...grant, sourceEdit: "true" } },
    { ...previous, grant: { ...grant, expiresAtMs: serverTime + WINDOW * 10 } },
  ]) {
    const result = inspectOfflineAuthorization(
      corrupt as typeof previous,
      account,
      start + 20_000,
    );
    expect(result).toMatchObject({
      read: false,
      sourceEdit: false,
      reason: "needs-check",
    });
    expect(result).not.toHaveProperty("deleteDrafts");
  }
});

it("does not interpret an unknown response protocol or an overflowing client instant as permission", () => {
  const previous = accept();
  expect(
    applyPermissionReply(
      previous,
      pending,
      { ...reply, kind: "future-v2" } as unknown as PermissionReply,
      account,
      requestId,
      start + 20_000,
    ),
  ).toMatchObject({ outcome: "invalid", authorization: previous });
  expect(
    applyPermissionReply(
      previous,
      { ...pending, startedAtMs: Number.MAX_SAFE_INTEGER - 1 },
      reply,
      account,
      requestId,
      Number.MAX_SAFE_INTEGER,
    ),
  ).toMatchObject({ outcome: "invalid", authorization: previous });
});

it.each(["", "legacy-session-epoch", "01993000-0000-7000-8000-00000000003A"])(
  "rejects matching but malformed persisted account epoch %j",
  (badEpoch) => {
    const stored = { ...accept(), accountEpoch: badEpoch };
    expect(
      inspectOfflineAuthorization(
        stored,
        { ownerId, epoch: badEpoch },
        start + 7000,
      ),
    ).toMatchObject({
      read: false,
      sourceEdit: false,
      reason: "account-mismatch",
    });
  },
);

it("rejects a corrupt active owner even when the stored account copy matches", () => {
  const stored = { ...accept(), ownerId: "legacy-owner" };
  expect(
    inspectOfflineAuthorization(
      stored,
      { ownerId: "legacy-owner", epoch },
      start + 7000,
    ),
  ).toMatchObject({
    read: false,
    sourceEdit: false,
    reason: "account-mismatch",
  });
});
