import { describe, expect, it } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  applyPermissionReply,
  emptyAuthorization,
  OFFLINE_AUTHORIZATION_WINDOW_MS,
} from "./lease";
import {
  parseRitualPermissionRequest,
  parseRitualPermissionResponse,
} from "./permissionContract";

const request = () => ({
  version: 1 as const,
  requestId: createUuidV7(),
  expectedActorId: createUuidV7(),
  ritualId: createUuidV7(),
});
const valid = (r = request()) => ({
  version: 1 as const,
  requestId: r.requestId,
  ownerId: r.expectedActorId,
  ritualId: r.ritualId,
  kind: "granted" as const,
  grant: {
    version: 1 as const,
    leaseId: createUuidV7(),
    ownerId: r.expectedActorId,
    ritualId: r.ritualId,
    checkedAtMs: 100,
    respondedAtMs: 200,
    expiresAtMs: 100 + OFFLINE_AUTHORIZATION_WINDOW_MS,
    sourceEdit: true,
  },
  editor: { currentRevisionId: createUuidV7(), parentVersion: 0 },
  rendered: {
    kind: "available" as const,
    descriptor: {
      descriptorSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
      outputFormat: "json-rich-text" as const,
      outputFormatVersion: "1" as const,
    },
  },
});
const transport = { status: 200, sameOrigin: true, uncached: true };
const temporary = (r: ReturnType<typeof request>) => ({
  version: 1,
  requestId: r.requestId,
  ownerId: r.expectedActorId,
  ritualId: r.ritualId,
  kind: "temporarily-unavailable",
});

describe("strict permission DTO boundary", () => {
  it("copies valid requests and replies, allowing full safe integer editor versions", () => {
    const r = request(),
      body = valid(r);
    body.editor.parentVersion = Number.MAX_SAFE_INTEGER;
    expect(parseRitualPermissionRequest(r)).toEqual(r);
    const result = parseRitualPermissionResponse(r, body, transport);
    expect(result).toEqual(body);
    body.grant.sourceEdit = false;
    body.rendered.descriptor.contentSha256 = "c".repeat(64);
    body.editor.parentVersion = 1;
    expect(result).toMatchObject({
      grant: { sourceEdit: true },
      editor: { parentVersion: Number.MAX_SAFE_INTEGER },
      rendered: { descriptor: { contentSha256: "b".repeat(64) } },
    });
  });
  it("accepts editor renewal without rendered output, and read-only renewal without editor tokens", () => {
    const r = request(),
      body = valid(r);
    expect(
      parseRitualPermissionResponse(
        r,
        {
          ...body,
          rendered: { kind: "temporarily-unavailable" },
          editor: null,
        },
        transport,
      )?.kind,
    ).toBe("granted");
    expect(
      parseRitualPermissionResponse(
        r,
        { ...body, grant: { ...body.grant, sourceEdit: false }, editor: null },
        transport,
      )?.kind,
    ).toBe("granted");
  });
  it.each([
    null,
    [],
    false,
    "",
    {},
    new Date(),
    { version: 1 },
    Object.create({
      version: 1,
      requestId: createUuidV7(),
      expectedActorId: createUuidV7(),
      ritualId: createUuidV7(),
    }),
  ])("rejects invalid request shape %j", (input) =>
    expect(parseRitualPermissionRequest(input)).toBeNull(),
  );
  it.each(["version", "requestId", "expectedActorId", "ritualId"])(
    "requires own canonical request %s",
    (key) => {
      const r = request();
      expect(
        parseRitualPermissionRequest({
          ...r,
          [key]: key === "version" ? 2 : "bad",
        }),
      ).toBeNull();
      expect(
        parseRitualPermissionRequest({ ...r, [key]: undefined }),
      ).toBeNull();
      if (key !== "version")
        expect(
          parseRitualPermissionRequest({
            ...r,
            [key]: createUuidV7().toUpperCase(),
          }),
        ).toBeNull();
      const missing = { ...r };
      delete missing[key as keyof typeof r];
      expect(parseRitualPermissionRequest(missing)).toBeNull();
    },
  );
  it("rejects extras, symbols, accessors and hostile proxies without invoking getters", () => {
    const r = request(),
      getter = Object.defineProperty({ ...r }, "ritualId", {
        get() {
          throw Error("private");
        },
        enumerable: true,
      });
    expect(parseRitualPermissionRequest(getter)).toBeNull();
    expect(parseRitualPermissionRequest({ ...r, extra: 1 })).toBeNull();
    expect(parseRitualPermissionRequest({ ...r, [Symbol()]: 1 })).toBeNull();
    expect(
      parseRitualPermissionRequest(
        new Proxy(r, {
          getPrototypeOf() {
            throw Error();
          },
        }),
      ),
    ).toBeNull();
    expect(
      parseRitualPermissionRequest(Object.assign(Object.create(null), r)),
    ).toEqual(r);
  });
  it.each([0, 201, 204, 301, 304, 400, 401, 403, 404, 500])(
    "HTTP %s cannot assert denial",
    (status) => {
      const r = request(),
        denied = { ...temporary(r), kind: "denied" };
      expect(
        parseRitualPermissionResponse(r, denied, { ...transport, status }),
      ).toEqual(temporary(r));
    },
  );
  it.each(["sameOrigin", "uncached"])(
    "requires explicit %s transport acceptance",
    (key) => {
      const r = request();
      expect(
        parseRitualPermissionResponse(
          r,
          { ...temporary(r), kind: "denied" },
          { ...transport, [key]: false },
        ),
      ).toEqual(temporary(r));
    },
  );
  it.each([
    null,
    undefined,
    false,
    42,
    "denied",
    [],
    {},
    new Error("secret"),
    { kind: "denied" },
    new Response("denied", { status: 403 }),
  ])("arbitrary body %j remains temporary", (body) => {
    const r = request();
    expect(parseRitualPermissionResponse(r, body, transport)).toEqual(
      temporary(r),
    );
  });
  it.each(["version", "requestId", "ownerId", "ritualId", "kind"])(
    "rejects wrong response %s binding",
    (key) => {
      const r = request(),
        body = { ...temporary(r), kind: "denied" };
      expect(
        parseRitualPermissionResponse(
          r,
          { ...body, [key]: key === "version" ? 2 : "invalid" },
          transport,
        ),
      ).toEqual(temporary(r));
    },
  );
  it.each(["denied", "authentication-required", "temporarily-unavailable"])(
    "accepts only explicit bound %s replies",
    (kind) => {
      const r = request(),
        body = { ...temporary(r), kind };
      expect(parseRitualPermissionResponse(r, body, transport)).toEqual(body);
      expect(
        parseRitualPermissionResponse(r, { ...body, extra: true }, transport),
      ).toEqual(temporary(r));
    },
  );
  it.each([
    ["version", 2],
    ["leaseId", "bad"],
    ["ownerId", createUuidV7()],
    ["ritualId", createUuidV7()],
    ["sourceEdit", 1],
    ["checkedAtMs", NaN],
    ["checkedAtMs", -0],
    ["checkedAtMs", -1],
    ["checkedAtMs", 201],
    ["respondedAtMs", Infinity],
    ["respondedAtMs", 99],
    ["respondedAtMs", 100 + OFFLINE_AUTHORIZATION_WINDOW_MS],
    ["expiresAtMs", 200],
    ["expiresAtMs", NaN],
    ["expiresAtMs", 101 + OFFLINE_AUTHORIZATION_WINDOW_MS],
  ])("rejects grant %s=%s", (key, value) => {
    const r = request(),
      body = valid(r);
    expect(
      parseRitualPermissionResponse(
        r,
        { ...body, grant: { ...body.grant, [key]: value } },
        transport,
      ),
    ).toEqual(temporary(r));
  });
  it.each([null, {}, [], { extra: 1 }])(
    "rejects incomplete grant %j",
    (grant) => {
      const r = request();
      expect(
        parseRitualPermissionResponse(r, { ...valid(r), grant }, transport),
      ).toEqual(temporary(r));
    },
  );
  it.each([
    undefined,
    {},
    [],
    { currentRevisionId: "bad", parentVersion: 0 },
    { currentRevisionId: createUuidV7(), parentVersion: -1 },
    { currentRevisionId: createUuidV7(), parentVersion: -0 },
    { currentRevisionId: createUuidV7(), parentVersion: 1.1 },
  ])("rejects malformed editor %j", (editor) => {
    const r = request();
    expect(
      parseRitualPermissionResponse(r, { ...valid(r), editor }, transport),
    ).toEqual(temporary(r));
  });
  it("rejects source tokens for readers and available output without an editor's required CAS", () => {
    const r = request(),
      body = valid(r);
    expect(
      parseRitualPermissionResponse(
        r,
        { ...body, grant: { ...body.grant, sourceEdit: false } },
        transport,
      ),
    ).toEqual(temporary(r));
    expect(
      parseRitualPermissionResponse(r, { ...body, editor: null }, transport),
    ).toEqual(temporary(r));
  });
  it.each([
    null,
    {},
    [],
    { kind: "ready" },
    { kind: "temporarily-unavailable", descriptor: {} },
    { kind: "available", descriptor: {} },
  ])("rejects malformed rendered %j", (rendered) => {
    const r = request();
    expect(
      parseRitualPermissionResponse(r, { ...valid(r), rendered }, transport),
    ).toEqual(temporary(r));
  });
  it.each([
    ["descriptorSha256", "A".repeat(64)],
    ["contentSha256", "abc"],
    ["outputFormat", "future"],
    ["outputFormatVersion", "2"],
  ])("rejects incompatible descriptor %s", (key, value) => {
    const r = request(),
      body = valid(r);
    expect(
      parseRitualPermissionResponse(
        r,
        {
          ...body,
          rendered: {
            ...body.rendered,
            descriptor: { ...body.rendered.descriptor, [key]: value },
          },
        },
        transport,
      ),
    ).toEqual(temporary(r));
  });
  it("never propagates hostile getters/proxies/errors and cannot bind to invalid caller request", () => {
    const r = request();
    expect(
      parseRitualPermissionResponse(
        r,
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor() {
              throw Error("secret");
            },
          },
        ),
        transport,
      ),
    ).toEqual(temporary(r));
    expect(parseRitualPermissionResponse(r, valid(r), null as never)).toEqual(
      temporary(r),
    );
    expect(
      parseRitualPermissionResponse(
        { ...r, version: 2 } as never,
        {},
        transport,
      ),
    ).toBeNull();
  });
  it("generic errors pause existing authority; only validated explicit denial purges", () => {
    const r = request(),
      account = { ownerId: r.expectedActorId, epoch: createUuidV7() },
      pending = {
        ownerId: account.ownerId,
        accountEpoch: account.epoch,
        ritualId: r.ritualId,
        requestId: r.requestId,
        startedAtMs: 1000,
      };
    const granted = parseRitualPermissionResponse(r, valid(r), transport)!;
    const previous = applyPermissionReply(
      emptyAuthorization(account, r.ritualId),
      pending,
      granted,
      account,
      r.requestId,
      1100,
    ).authorization;
    const error = parseRitualPermissionResponse(
      r,
      { kind: "denied" },
      { ...transport, status: 403 },
    )!;
    expect(
      applyPermissionReply(
        previous,
        pending,
        error,
        account,
        r.requestId,
        1200,
      ),
    ).toMatchObject({
      authorization: previous,
      outcome: "paused",
      purgeDownloads: false,
      purgeSourceSnapshots: false,
      lockDrafts: false,
    });
    const denied = parseRitualPermissionResponse(
      r,
      { ...temporary(r), kind: "denied" },
      transport,
    )!;
    expect(
      applyPermissionReply(
        previous,
        pending,
        denied,
        account,
        r.requestId,
        1200,
      ),
    ).toMatchObject({
      outcome: "accepted",
      purgeDownloads: true,
      purgeSourceSnapshots: true,
      lockDrafts: true,
    });
  });
});
