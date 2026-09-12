import { describe, expect, it } from "vitest";
import {
  authorizeRevisionAttachment,
  authorizeRevisionInsert,
  authorizeRevisionUpdate,
  authorizeRitualContentUpdate,
  authorizeRitualCreation,
  authorizeRitualPublication,
  getRitualAccess,
  parseRitualScope,
  type RitualPolicy,
  type RitualPrincipal,
  type RitualRevisionIdentity,
} from "./access";

const publicDoc: RitualPolicy = {
  id: "ritual",
  creatorId: "creator",
  scope: { kind: "public" },
};
const groupDoc: RitualPolicy = {
  ...publicDoc,
  scope: { kind: "group", groupId: "group" },
};
const templeDoc: RitualPolicy = {
  ...publicDoc,
  scope: { kind: "temple", templeId: "temple", minGrade: 2 },
};
const zeroDoc: RitualPolicy = {
  ...templeDoc,
  scope: { kind: "temple", templeId: "temple", minGrade: 0 },
};
const actor = (overrides: Partial<RitualPrincipal> = {}): RitualPrincipal => ({
  userId: "reader",
  globalAdmin: false,
  groupIds: [],
  groupAdminIds: [],
  templeMemberships: [],
  ...overrides,
});
const member = (grade: number | null, admin = false, templeId = "temple") =>
  actor({
    templeMemberships: [{ templeId, grade, admin }],
  });
const denied = { read: false, edit: false, readSourceHistory: false };

// Public, group, temple grade 2, temple grade 0. Synthetic domains cover scopes
// absent from the production data; no real ritual source or memberships are used.
const cases: [string, RitualPrincipal | null, boolean[], boolean[]][] = [
  [
    "anonymous",
    null,
    [true, false, false, false],
    [false, false, false, false],
  ],
  [
    "unrelated user",
    actor(),
    [true, false, false, false],
    [false, false, false, false],
  ],
  [
    "creator without any membership",
    actor({ userId: "creator" }),
    [true, true, true, true],
    [true, true, true, true],
  ],
  [
    "global admin without any membership",
    actor({ globalAdmin: true }),
    [true, true, true, true],
    [true, true, true, true],
  ],
  [
    "matching group member",
    actor({ groupIds: ["group"] }),
    [true, true, false, false],
    [false, false, false, false],
  ],
  [
    "matching group admin without membership",
    actor({ groupAdminIds: ["group"] }),
    [true, true, false, false],
    [false, true, false, false],
  ],
  [
    "other group admin/member",
    actor({ groupIds: ["other"], groupAdminIds: ["other"] }),
    [true, false, false, false],
    [false, false, false, false],
  ],
  [
    "temple grade zero",
    member(0),
    [true, false, false, true],
    [false, false, false, false],
  ],
  [
    "temple grade below minimum",
    member(1),
    [true, false, false, true],
    [false, false, false, false],
  ],
  [
    "temple grade exactly minimum",
    member(2),
    [true, false, true, true],
    [false, false, false, false],
  ],
  [
    "temple grade above minimum",
    member(3),
    [true, false, true, true],
    [false, false, false, false],
  ],
  [
    "temple missing grade",
    member(null),
    [true, false, false, false],
    [false, false, false, false],
  ],
  [
    "temple admin with grade zero",
    member(0, true),
    [true, false, true, true],
    [false, false, true, true],
  ],
  [
    "temple admin without grade",
    member(null, true),
    [true, false, true, true],
    [false, false, true, true],
  ],
  [
    "other temple admin",
    member(10, true, "other"),
    [true, false, false, false],
    [false, false, false, false],
  ],
];

describe("shared ritual read/edit/source-history matrix", () => {
  it.each(cases)("%s", (_label, principal, reads, edits) => {
    [publicDoc, groupDoc, templeDoc, zeroDoc].forEach((doc, index) => {
      expect(getRitualAccess(doc, principal)).toEqual({
        read: reads[index],
        edit: edits[index],
        readSourceHistory: edits[index],
      });
    });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid membership grade %s",
    (grade) => {
      expect(getRitualAccess(zeroDoc, member(grade))).toEqual(denied);
    },
  );

  it("does not promote empty unauthenticated identities or truthy flags", () => {
    expect(
      getRitualAccess(templeDoc, actor({ userId: "", globalAdmin: true })),
    ).toEqual(denied);
    expect(
      getRitualAccess(
        templeDoc,
        actor({ globalAdmin: "true" as unknown as boolean }),
      ),
    ).toEqual(denied);
    expect(
      getRitualAccess(templeDoc, member(0, "true" as unknown as boolean)),
    ).toEqual(denied);
  });

  it("does not give revision authors continuing access after membership removal", () => {
    // Authorship belongs to a revision; only ritual creatorId grants creator rights.
    expect(
      getRitualAccess(templeDoc, actor({ userId: "former-editor" })),
    ).toEqual(denied);
  });

  it.each([
    null,
    { ...templeDoc, creatorId: "" },
    {
      ...templeDoc,
      scope: {
        kind: "temple",
        templeId: "temple",
        minGrade: 0,
        groupId: "group",
      },
    },
  ])("denies malformed policies even for privileged readers", (invalid) => {
    for (const principal of [
      null,
      actor({ userId: "creator" }),
      actor({ globalAdmin: true }),
      member(10, true),
    ]) {
      expect(
        getRitualAccess(invalid as RitualPolicy | null, principal),
      ).toEqual(denied);
    }
  });
});

describe("exclusive scopes for new writes", () => {
  it.each([publicDoc.scope, groupDoc.scope, templeDoc.scope, zeroDoc.scope])(
    "accepts %j",
    (scope) => {
      expect(parseRitualScope(scope)).toEqual(scope);
    },
  );
  it.each([
    null,
    [],
    {},
    { kind: "public", groupId: "group" },
    { kind: "public", minGrade: 0 },
    { kind: "group", groupId: "group", templeId: "temple" },
    { kind: "group", groupId: "" },
    { kind: "group", groupId: { toString: (): string => "group" } },
    { kind: "temple", templeId: "temple" },
    { kind: "temple", templeId: "temple", minGrade: "0" },
    { kind: "temple", templeId: "temple", minGrade: -1 },
    { kind: "temple", templeId: "temple", minGrade: 0.5 },
    { kind: "temple", templeId: "temple", minGrade: null },
    { kind: "owner", userId: "creator" },
  ])("rejects %j", (scope) => expect(parseRitualScope(scope)).toBeNull());
});

describe("ordinary content and title saves", () => {
  it("allows creator and matching scope admins to retain the existing policy", () => {
    for (const principal of [
      actor({ userId: "creator" }),
      actor({ globalAdmin: true }),
      member(0, true),
    ]) {
      expect(
        authorizeRitualContentUpdate(templeDoc, { ...templeDoc }, principal),
      ).toEqual({ allowed: true });
    }
    expect(
      authorizeRitualContentUpdate(
        groupDoc,
        { ...groupDoc },
        actor({ groupAdminIds: ["group"] }),
      ),
    ).toEqual({ allowed: true });
    expect(
      authorizeRitualContentUpdate(
        publicDoc,
        publicDoc,
        actor({ userId: "creator" }),
      ),
    ).toEqual({ allowed: true });
  });

  it.each([
    { ...templeDoc, scope: { kind: "public" } },
    { ...templeDoc, scope: { kind: "group", groupId: "group" } },
    { ...templeDoc, scope: { kind: "temple", templeId: "other", minGrade: 2 } },
    {
      ...templeDoc,
      scope: { kind: "temple", templeId: "temple", minGrade: 0 },
    },
    {
      ...templeDoc,
      scope: { kind: "temple", templeId: "temple", minGrade: 3 },
    },
    { ...templeDoc, creatorId: "other" },
    { ...templeDoc, id: "other" },
  ])("requires a separate policy command for %j", (proposed) => {
    for (const principal of [
      actor({ userId: "creator" }),
      actor({ globalAdmin: true }),
      member(0, true),
    ]) {
      expect(
        authorizeRitualContentUpdate(
          templeDoc,
          proposed as RitualPolicy,
          principal,
        ),
      ).toEqual({
        allowed: false,
        reason: "policy-change-requires-separate-command",
      });
    }
  });

  it("cannot obtain edit rights from a proposed creator or scope change", () => {
    expect(
      authorizeRitualContentUpdate(
        templeDoc,
        { ...templeDoc, creatorId: "reader" },
        actor(),
      ),
    ).toEqual({
      allowed: false,
      reason: "not-an-editor",
    });
    expect(
      authorizeRitualContentUpdate(
        templeDoc,
        { ...templeDoc, scope: { kind: "group", groupId: "mine" } },
        actor({ groupAdminIds: ["mine"] }),
      ),
    ).toEqual({
      allowed: false,
      reason: "not-an-editor",
    });
  });

  it("rejects invalid proposed scopes and ordinary member edits", () => {
    expect(
      authorizeRitualContentUpdate(templeDoc, null, member(0, true)),
    ).toEqual({ allowed: false, reason: "invalid-policy" });
    expect(
      authorizeRitualContentUpdate(templeDoc, templeDoc, member(2)),
    ).toEqual({ allowed: false, reason: "not-an-editor" });
  });
});

const revision: RitualRevisionIdentity = {
  id: "revision",
  ritualId: "ritual",
  authorId: "editor",
  createdAt: 1234,
};
const editingUser = actor({
  userId: "editor",
  templeMemberships: [{ templeId: "temple", grade: 0, admin: true }],
});
describe("revision identity, parent and current authority", () => {
  it("allows a parent editor's own new revision and attachment", () => {
    expect(authorizeRevisionInsert(templeDoc, revision, editingUser)).toEqual({
      allowed: true,
    });
    expect(
      authorizeRevisionAttachment(templeDoc, revision, editingUser),
    ).toEqual({ allowed: true });
    expect(
      authorizeRevisionUpdate(
        templeDoc,
        revision,
        { ...revision },
        editingUser,
      ),
    ).toEqual({ allowed: true });
  });

  it.each([null, actor({ userId: "editor" }), member(2)])(
    "requires current edit authority for every write",
    (principal) => {
      expect(authorizeRevisionInsert(templeDoc, revision, principal)).toEqual({
        allowed: false,
        reason: "not-an-editor",
      });
      expect(
        authorizeRevisionUpdate(templeDoc, revision, revision, principal),
      ).toEqual({ allowed: false, reason: "not-an-editor" });
      expect(
        authorizeRevisionAttachment(templeDoc, revision, principal),
      ).toEqual({ allowed: false, reason: "not-an-editor" });
    },
  );

  it("binds inserted/attached revisions to the authorized parent", () => {
    const foreignRevision = { ...revision, ritualId: "private-other-ritual" };
    expect(
      authorizeRevisionInsert(templeDoc, foreignRevision, editingUser),
    ).toEqual({ allowed: false, reason: "revision-parent-mismatch" });
    expect(
      authorizeRevisionAttachment(templeDoc, foreignRevision, editingUser),
    ).toEqual({ allowed: false, reason: "revision-parent-mismatch" });
    expect(
      authorizeRevisionUpdate(
        templeDoc,
        foreignRevision,
        revision,
        editingUser,
      ),
    ).toEqual({ allowed: false, reason: "revision-parent-mismatch" });
  });

  it("cannot forge revision authors or overwrite another editor's history", () => {
    for (const principal of [
      editingUser,
      { ...editingUser, globalAdmin: true },
    ]) {
      const other = { ...revision, authorId: "other" };
      expect(authorizeRevisionInsert(templeDoc, other, principal)).toEqual({
        allowed: false,
        reason: "revision-author-mismatch",
      });
      expect(
        authorizeRevisionUpdate(templeDoc, other, revision, principal),
      ).toEqual({ allowed: false, reason: "revision-author-mismatch" });
      expect(authorizeRevisionAttachment(templeDoc, other, principal)).toEqual({
        allowed: false,
        reason: "revision-author-mismatch",
      });
    }
  });

  it.each([
    { ...revision, id: "other" },
    { ...revision, ritualId: "other" },
    { ...revision, authorId: "other" },
    { ...revision, createdAt: 1235 },
  ])("makes coalesced revision identity immutable: %j", (proposed) => {
    expect(
      authorizeRevisionUpdate(templeDoc, revision, proposed, editingUser),
    ).toEqual({ allowed: false, reason: "revision-identity-changed" });
  });
});

describe("explicit creation and publication privileges", () => {
  it.each([
    ["anonymous", null, [false, false, false]],
    ["ordinary user", actor(), [false, false, false]],
    ["global admin", actor({ globalAdmin: true }), [true, true, true]],
    [
      "matching group admin",
      actor({ groupAdminIds: ["group"] }),
      [false, true, false],
    ],
    ["group member", actor({ groupIds: ["group"] }), [false, false, false]],
    ["matching temple admin", member(0, true), [false, false, true]],
    ["temple member", member(10), [false, false, false]],
    [
      "other scope admin",
      actor({
        groupAdminIds: ["other"],
        templeMemberships: [{ templeId: "other", grade: 10, admin: true }],
      }),
      [false, false, false],
    ],
  ] as [string, RitualPrincipal | null, boolean[]][])(
    "creates only authorized scopes: %s",
    (_label, principal, expected) => {
      for (const [index, doc] of [publicDoc, groupDoc, templeDoc].entries()) {
        expect(
          authorizeRitualCreation({ ...doc, creatorId: "reader" }, principal)
            .allowed,
        ).toBe(expected[index]);
      }
    },
  );
  it("does not let creators self-authorize creation or forge a different creator", () => {
    expect(
      authorizeRitualCreation(publicDoc, actor({ userId: "creator" })).allowed,
    ).toBe(false);
    expect(
      authorizeRitualCreation(publicDoc, actor({ globalAdmin: true })),
    ).toEqual({ allowed: false, reason: "creator-mismatch" });
    expect(authorizeRitualCreation(null, actor({ globalAdmin: true }))).toEqual(
      { allowed: false, reason: "invalid-policy" },
    );
  });
  it.each([groupDoc, templeDoc, publicDoc])(
    "global admin can explicitly publish %j with stable identity",
    (doc) => {
      expect(
        authorizeRitualPublication(
          doc,
          { ...doc, scope: { kind: "public" } },
          actor({ globalAdmin: true }),
        ),
      ).toEqual({ allowed: true });
    },
  );
  it.each([
    null,
    actor(),
    actor({ userId: "creator" }),
    actor({ groupAdminIds: ["group"] }),
    member(0, true),
  ])("does not let another editor publish", (principal) => {
    expect(authorizeRitualPublication(templeDoc, publicDoc, principal)).toEqual(
      { allowed: false, reason: "not-global-admin" },
    );
  });
  it.each([
    null,
    {
      ...templeDoc,
      scope: { kind: "group", groupId: "group", templeId: "temple" },
    },
  ])("does not use publication to repair malformed legacy policy", (doc) => {
    expect(
      authorizeRitualPublication(
        doc as RitualPolicy | null,
        publicDoc,
        actor({ globalAdmin: true }),
      ),
    ).toEqual({ allowed: false, reason: "invalid-policy" });
  });
  it("does not use publication for ownership/identity transfer or a different destination", () => {
    const principal = actor({ globalAdmin: true });
    expect(
      authorizeRitualPublication(
        templeDoc,
        { ...publicDoc, creatorId: "other" },
        principal,
      ),
    ).toEqual({
      allowed: false,
      reason: "policy-change-requires-separate-command",
    });
    expect(
      authorizeRitualPublication(
        templeDoc,
        { ...publicDoc, id: "other" },
        principal,
      ),
    ).toEqual({
      allowed: false,
      reason: "policy-change-requires-separate-command",
    });
    expect(authorizeRitualPublication(templeDoc, groupDoc, principal)).toEqual({
      allowed: false,
      reason: "invalid-policy",
    });
  });
});

describe("nullable unresolved creator", () => {
  it.each(cases)(
    "retains membership/public/admin rights without inventing an owner: %s",
    (_label, principal, reads, edits) => {
      for (const [index, doc] of [
        publicDoc,
        groupDoc,
        templeDoc,
        zeroDoc,
      ].entries()) {
        const actual = getRitualAccess({ ...doc, creatorId: null }, principal);
        if (principal?.userId === "creator") {
          expect(actual).toEqual(
            index === 0
              ? { read: true, edit: false, readSourceHistory: false }
              : { read: false, edit: false, readSourceHistory: false },
          );
        } else {
          expect(actual).toEqual({
            read: reads[index],
            edit: edits[index],
            readSourceHistory: edits[index],
          });
        }
      }
    },
  );
  it("requires explicit ownership assignment rather than a normal content save", () => {
    const unresolved = { ...templeDoc, creatorId: null };
    const principal = actor({ globalAdmin: true });
    expect(
      authorizeRitualContentUpdate(unresolved, unresolved, principal).allowed,
    ).toBe(true);
    expect(
      authorizeRitualContentUpdate(unresolved, templeDoc, principal),
    ).toEqual({
      allowed: false,
      reason: "policy-change-requires-separate-command",
    });
    expect(
      authorizeRitualPublication(
        unresolved,
        { ...publicDoc, creatorId: null },
        principal,
      ).allowed,
    ).toBe(true);
    expect(authorizeRitualCreation(unresolved, principal)).toEqual({
      allowed: false,
      reason: "creator-mismatch",
    });
  });
});
