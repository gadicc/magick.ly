import { describe, expect, it } from "vitest";
import {
  importSecret,
  legacyImportFixture,
} from "../../tests/legacyImportFixtures";
import {
  classifyLegacyAuthSource,
  LegacyAuthSourceError,
} from "./classifyLegacyAuthSource";

type Row = Record<string, unknown>;
type Input = Parameters<typeof classifyLegacyAuthSource>[0];
const input = (): Input => {
  const { users, accounts, sessions } = legacyImportFixture().input;
  return { users, accounts, sessions };
};
const user = (v: Input) => v.users[0] as Row;
const service = (v: Input) => (user(v).services as Row[])[0];
const profile = (v: Input) => service(v).profile as Row;
const account = (v: Input) => v.accounts[0] as Row;
describe("legacy auth source field dispositions", () => {
  it.each([undefined, {}, 1, true, "bad\0value", "\ud800"])(
    "rejects unsupported historical profile values %#",
    (value) => {
      const v = input();
      user(v).locale = value;
      expect(() => classifyLegacyAuthSource(v)).toThrow(LegacyAuthSourceError);
      delete user(v).locale;
      (user(v).photos as Row[])[0].provider = value;
      expect(() => classifyLegacyAuthSource(v)).toThrow(LegacyAuthSourceError);
    },
  );
  it("counts intentional secret discards without returning their values", () => {
    const result = classifyLegacyAuthSource(input());
    expect(result.counts).toEqual({
      sessionRowsDiscarded: 1,
      strategyRowsExcluded: 1,
      embeddedTokenFieldsDropped: 4,
      providerProfileSubtreesDropped: 4,
      modernOauthFieldsDropped: 12,
    });
    expect(JSON.stringify(result)).not.toContain(importSecret);
  });
  it("does not traverse opaque discarded profile, strategy or session contents", () => {
    const v = input();
    const opaque = Object.defineProperty({}, "private", {
      get() {
        throw new Error(importSecret);
      },
    });
    profile(v)._json = opaque;
    profile(v)._raw = opaque;
    (v.accounts[2] as Row).oauth2 = opaque;
    (v.sessions as unknown[])[0] = opaque;
    expect(classifyLegacyAuthSource(v).counts.sessionRowsDiscarded).toBe(1);
  });
  it("classifies empty/minimal containers while leaving identity validation to the normalizer", () => {
    expect(
      classifyLegacyAuthSource({
        users: [
          {
            _id: "later-validator",
            name: null,
            displayName: undefined,
            services: [{ service: "google" }],
          },
        ],
        accounts: [],
        sessions: [],
      }).counts,
    ).toEqual({
      sessionRowsDiscarded: 0,
      strategyRowsExcluded: 0,
      embeddedTokenFieldsDropped: 0,
      providerProfileSubtreesDropped: 0,
      modernOauthFieldsDropped: 0,
    });
    expect(
      classifyLegacyAuthSource({ users: [], accounts: [], sessions: [] }).counts
        .sessionRowsDiscarded,
    ).toBe(0);
  });
  const targets = [
    user,
    service,
    profile,
    account,
    (v: Input) => v.accounts[2] as Row,
    (v: Input) => user(v).name as Row,
    (v: Input) => (user(v).emails as Row[])[0],
    (v: Input) => (user(v).photos as Row[])[0],
    (v: Input) => profile(v).name as Row,
    (v: Input) => (profile(v).emails as Row[])[0],
    (v: Input) => (profile(v).photos as Row[])[0],
  ];
  it.each(targets)(
    "rejects unknown/private field names without echoing them %#",
    (target) => {
      const v = input();
      target(v)[importSecret] = true;
      try {
        classifyLegacyAuthSource(v);
        throw new Error("expected refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyAuthSourceError);
        expect((error as Error).message).not.toContain(importSecret);
      }
    },
  );
  it.each(["password", "__deleted", "__pendingDelete", "newGrant"])(
    "rejects unclassified user field %s",
    (field) => {
      const v = input();
      user(v)[field] = true;
      expect(() => classifyLegacyAuthSource(v)).toThrow(LegacyAuthSourceError);
    },
  );
  it.each(targets)(
    "rejects non-data properties without reading them %#",
    (target) => {
      const v = input();
      const object = target(v),
        key = Object.keys(object)[0];
      Object.defineProperty(object, key, {
        get() {
          throw new Error(importSecret);
        },
        enumerable: true,
      });
      expect(() => classifyLegacyAuthSource(v)).toThrow(LegacyAuthSourceError);
    },
  );
  it.each([
    (v: Input) => {
      user(v).name = [];
    },
    (v: Input) => {
      user(v).name = new Date();
    },
    (v: Input) => {
      user(v).emails = null;
    },
    (v: Input) => {
      user(v).photos = {};
    },
    (v: Input) => {
      user(v).services = new Array(2);
    },
    (v: Input) => {
      Object.defineProperty(v.users, "0", {
        get() {
          throw new Error(importSecret);
        },
        enumerable: true,
      });
    },
    (v: Input) => {
      (v.accounts as unknown as Row).extra = true;
    },
    (v: Input) => {
      (v.sessions as unknown as Record<symbol, unknown>)[Symbol()] = 1;
    },
    (v: Input) => {
      user(v).services = [{ profile: null }];
    },
    (v: Input) => {
      service(v).profile = new Map();
    },
    (v: Input) => {
      Object.defineProperty(user(v), "email", {
        value: "private",
        enumerable: false,
      });
    },
    (v: Input) => {
      (user(v) as Record<symbol, unknown>)[Symbol()] = true;
    },
    (v: Input) => {
      (v.accounts[2] as Row).access_token = importSecret;
    },
    (v: Input) => {
      account(v).oauth2 = {};
    },
    (v: Input) => {
      (v as unknown as Row).other = true;
    },
    (v: Input) => {
      v.accounts = [] as unknown[];
      v.users = null as never;
    },
  ])("refuses unsupported source container %#", (change) => {
    const v = input();
    change(v);
    expect(() => classifyLegacyAuthSource(v)).toThrow(LegacyAuthSourceError);
  });
});
