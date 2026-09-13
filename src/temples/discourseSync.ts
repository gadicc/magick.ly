import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { user } from "../db/schema/auth";
import { discourseUserLinks } from "../db/schema/discourse";
import { templeMemberships, temples } from "../db/schema/memberships";
import {
  legacyUserEmails,
  userAccess,
  userProfile,
} from "../db/schema/userProfile";
import { isUuidV7 } from "../lib/ids";

export const MAGICKLY_DISCOURSE_ORIGIN = "https://forums.magick.ly";

type Transaction = Pick<PgDatabase<PgQueryResultHKT>, "select" | "insert">;

export interface DiscourseSyncDatabase extends Transaction {
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}

export interface ForumGroup {
  id: number;
  name: string;
  title: string | null;
}

export interface ForumUser {
  id: number;
  username: string;
  title: string | null;
  primaryGroupId: number | null;
}

export interface ForumUserCandidate {
  id: number;
}

export interface ForumCreateResult {
  success: boolean;
  userId: number | null;
}

export interface ForumGroupPage {
  groups: ForumGroup[];
}

export interface ForumGroupMemberPage {
  memberIds: number[];
  total: number;
  limit: number;
  offset: number;
}

export interface DiscourseSyncTransport {
  listGroupsPage(page: number): Promise<ForumGroupPage>;
  createGroup(seed: ForumGroupSeed): Promise<ForumGroup>;
  configureGroup(groupId: number, seed: ForumGroupSeed): Promise<void>;
  listGroupMemberPage(
    groupName: string,
    offset: number,
  ): Promise<ForumGroupMemberPage>;
  getUser(userId: number): Promise<ForumUser | null>;
  findUsersByEmail(email: string): Promise<ForumUserCandidate[]>;
  createUser(input: {
    name: string;
    email: string;
    password: string;
    username: string;
  }): Promise<ForumCreateResult>;
  updateUsername(username: string, newUsername: string): Promise<void>;
  addGroupMember(groupId: number, username: string): Promise<void>;
  removeGroupMember(groupId: number, username: string): Promise<void>;
  setPrimaryGroup(userId: number, groupId: number): Promise<void>;
  setTitle(username: string, title: string): Promise<void>;
}

export interface DiscourseSyncState {
  status: "idle" | "success" | "warning" | "error";
  message: string;
  progress: string[];
  completed: number;
  skipped: number;
  total: number;
}

export const initialDiscourseSyncState: DiscourseSyncState = {
  status: "idle",
  message: "",
  progress: [],
  completed: 0,
  skipped: 0,
  total: 0,
};

export interface ForumGroupSeed {
  name: string;
  fullName: string;
  title: string;
  grade: number;
}

export const forumGroupSeed: readonly ForumGroupSeed[] = [
  { name: "neophytes", fullName: "Neophytes", title: "Neophyte", grade: 0 },
  { name: "zelators", fullName: "Zelators", title: "Zelator", grade: 1 },
  { name: "theorici", fullName: "Theorici", title: "Theoricus", grade: 2 },
  { name: "practici", fullName: "Practici", title: "Practicus", grade: 3 },
  {
    name: "philosophi",
    fullName: "Philosophi",
    title: "Philosophus",
    grade: 4,
  },
  {
    name: "adepti-minores",
    fullName: "Adepti Minores",
    title: "Adeptus Minor",
    grade: 5,
  },
  {
    name: "adepti-majores",
    fullName: "Adepti Majores",
    title: "Adeptus Major",
    grade: 6,
  },
];

const MAX_GROUP_PAGES = 100;
const MAX_GROUP_MEMBER_PAGES = 200;
const MAX_GROUP_MEMBERS = 10_000;

class SyncFailure extends Error {
  constructor(
    readonly code:
      | "authorization"
      | "invalid-request"
      | "link-conflict"
      | "membership-changed"
      | "provider",
  ) {
    super(code);
  }
}

function isCanonicalId(value: string) {
  const input: unknown = value;
  return (
    typeof input === "string" &&
    isUuidV7(input) &&
    input === input.toLowerCase()
  );
}

function isSafeExternalId(value: number): value is number {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeForumUsername(value?: string | null) {
  const trimmed = value?.trim().replace(/\s+/g, "_");
  if (!trimmed) return null;
  if (trimmed.length <= 20) return trimmed;
  const lastSeparator = trimmed.lastIndexOf("_", 20);
  return trimmed.slice(0, lastSeparator > 0 ? lastSeparator : 20);
}

async function hasGlobalAdminAccess(
  database: Pick<DiscourseSyncDatabase, "select">,
  actorId: string,
) {
  if (!isCanonicalId(actorId)) return false;
  const [identity] = await database
    .select({ id: user.id })
    .from(user)
    .innerJoin(userAccess, eq(userAccess.userId, user.id))
    .where(and(eq(user.id, actorId), eq(userAccess.admin, true)));
  return Boolean(identity);
}

export async function canRunDiscourseSync(
  database: Pick<DiscourseSyncDatabase, "select">,
  actorId: string | null,
) {
  return actorId ? hasGlobalAdminAccess(database, actorId) : false;
}

async function loadCurrentLink(
  database: Pick<DiscourseSyncDatabase, "select">,
  userId: string,
  forumOrigin: string,
) {
  const [link] = await database
    .select({ discourseUserId: discourseUserLinks.discourseUserId })
    .from(discourseUserLinks)
    .where(
      and(
        eq(discourseUserLinks.userId, userId),
        eq(discourseUserLinks.forumOrigin, forumOrigin),
      ),
    );
  return link?.discourseUserId ?? null;
}

async function persistLink(
  database: DiscourseSyncDatabase,
  userId: string,
  forumOrigin: string,
  discourseUserId: number,
) {
  if (!isSafeExternalId(discourseUserId)) throw new SyncFailure("provider");
  return database.transaction(async (tx) => {
    await tx
      .insert(discourseUserLinks)
      .values({ userId, forumOrigin, discourseUserId })
      .onConflictDoNothing();
    const [ownedLink] = await tx
      .select({ discourseUserId: discourseUserLinks.discourseUserId })
      .from(discourseUserLinks)
      .where(
        and(
          eq(discourseUserLinks.userId, userId),
          eq(discourseUserLinks.forumOrigin, forumOrigin),
        ),
      );
    if (ownedLink?.discourseUserId !== discourseUserId)
      throw new SyncFailure("link-conflict");
    return discourseUserId;
  });
}

interface MemberForSync {
  membershipId: string;
  userId: string;
  grade: number;
  motto: string | null;
  displayName: string;
  emails: string[];
  discourseUserId: number | null;
}

async function loadMemberForSync(
  database: DiscourseSyncDatabase,
  templeId: string,
  membershipId: string,
  forumOrigin: string,
): Promise<MemberForSync | null> {
  const [row] = await database
    .select({
      membershipId: templeMemberships.id,
      userId: user.id,
      grade: templeMemberships.grade,
      motto: templeMemberships.motto,
      accountName: user.name,
      profileName: userProfile.displayName,
      accountEmail: user.email,
      accountEmailVerified: user.emailVerified,
      discourseUserId: discourseUserLinks.discourseUserId,
    })
    .from(templeMemberships)
    .innerJoin(user, eq(user.id, templeMemberships.userId))
    .leftJoin(userProfile, eq(userProfile.userId, user.id))
    .leftJoin(
      discourseUserLinks,
      and(
        eq(discourseUserLinks.userId, user.id),
        eq(discourseUserLinks.forumOrigin, forumOrigin),
      ),
    )
    .where(
      and(
        eq(templeMemberships.id, membershipId),
        eq(templeMemberships.templeId, templeId),
      ),
    );
  if (!row) return null;

  const legacyEmails = await database
    .select({
      value: legacyUserEmails.value,
      normalizedValue: legacyUserEmails.normalizedValue,
    })
    .from(legacyUserEmails)
    .where(
      and(
        eq(legacyUserEmails.userId, row.userId),
        eq(legacyUserEmails.verified, true),
      ),
    )
    .orderBy(asc(legacyUserEmails.normalizedValue), asc(legacyUserEmails.id));

  const emails = new Map<string, string>();
  if (row.accountEmailVerified) {
    const normalized = normalizedEmail(row.accountEmail);
    if (normalized) emails.set(normalized, row.accountEmail.trim());
  }
  for (const email of legacyEmails) {
    const normalized = normalizedEmail(email.normalizedValue);
    if (normalized && !emails.has(normalized))
      emails.set(normalized, email.value);
  }

  return {
    membershipId: row.membershipId,
    userId: row.userId,
    grade: row.grade,
    motto: row.motto,
    displayName: row.profileName?.trim() || row.accountName,
    emails: [...emails.values()],
    discourseUserId: row.discourseUserId ?? null,
  };
}

function safeFailureMessage(error: unknown) {
  if (error instanceof SyncFailure) {
    if (error.code === "authorization")
      return "Sync stopped because your administrator access changed.";
    if (error.code === "invalid-request") return "The sync request is invalid.";
    if (error.code === "link-conflict")
      return "Sync stopped because a forum identity link changed. No existing link was overwritten.";
    if (error.code === "membership-changed")
      return "Sync stopped because temple membership data changed. Run it again to use the current membership.";
  }
  return "Discourse sync stopped after a forum operation failed. Check forum availability before retrying.";
}

export function createSqlDiscourseSync(
  database: DiscourseSyncDatabase,
  options: {
    getCurrentActorId: () => Promise<string | null>;
    transport: DiscourseSyncTransport;
    forumOrigin?: string;
    createPassword?: () => string;
  },
) {
  const forumOrigin = options.forumOrigin ?? MAGICKLY_DISCOURSE_ORIGIN;
  const createPassword = options.createPassword ?? (() => crypto.randomUUID());

  async function guard(expectedActorId: string) {
    const currentActorId = await options.getCurrentActorId();
    if (
      currentActorId !== expectedActorId ||
      !(await hasGlobalAdminAccess(database, expectedActorId))
    )
      throw new SyncFailure("authorization");
  }

  async function callProvider<T>(
    expectedActorId: string,
    operation: () => Promise<T>,
  ) {
    await guard(expectedActorId);
    return operation();
  }

  async function guardMember(
    expectedActorId: string,
    templeId: string,
    member: MemberForSync,
  ) {
    await guard(expectedActorId);
    const [current] = await database
      .select({
        id: templeMemberships.id,
        grade: templeMemberships.grade,
        motto: templeMemberships.motto,
      })
      .from(templeMemberships)
      .where(
        and(
          eq(templeMemberships.id, member.membershipId),
          eq(templeMemberships.templeId, templeId),
          eq(templeMemberships.userId, member.userId),
        ),
      );
    if (
      !current ||
      current.grade !== member.grade ||
      current.motto !== member.motto
    )
      throw new SyncFailure("membership-changed");
  }

  async function callMemberProvider<T>(
    expectedActorId: string,
    templeId: string,
    member: MemberForSync,
    operation: () => Promise<T>,
  ) {
    await guardMember(expectedActorId, templeId, member);
    return operation();
  }

  async function loadForumGroups(expectedActorId: string) {
    const groups = new Map<string, ForumGroup>();
    for (let page = 0; page < MAX_GROUP_PAGES; page += 1) {
      const result = await callProvider(expectedActorId, () =>
        options.transport.listGroupsPage(page),
      );
      if (!Array.isArray(result.groups)) throw new SyncFailure("provider");
      if (result.groups.length === 0) return [...groups.values()];
      for (const group of result.groups) {
        if (
          !isSafeExternalId(group.id) ||
          !group.name ||
          groups.has(group.name)
        )
          throw new SyncFailure("provider");
        groups.set(group.name, group);
      }
      if (forumGroupSeed.every((seed) => groups.has(seed.name)))
        return [...groups.values()];
    }
    throw new SyncFailure("provider");
  }

  async function loadGroupMemberIds(
    expectedActorId: string,
    groupName: string,
  ) {
    const memberIds = new Set<number>();
    let offset = 0;
    let expectedTotal: number | null = null;
    for (let page = 0; page < MAX_GROUP_MEMBER_PAGES; page += 1) {
      const result = await callProvider(expectedActorId, () =>
        options.transport.listGroupMemberPage(groupName, offset),
      );
      if (
        !Number.isSafeInteger(result.total) ||
        result.total < 0 ||
        result.total > MAX_GROUP_MEMBERS ||
        !Number.isSafeInteger(result.limit) ||
        result.limit < 1 ||
        result.limit > MAX_GROUP_MEMBERS ||
        result.offset !== offset ||
        !Array.isArray(result.memberIds) ||
        result.memberIds.length > result.limit ||
        (expectedTotal !== null && result.total !== expectedTotal)
      )
        throw new SyncFailure("provider");
      expectedTotal = result.total;
      for (const memberId of result.memberIds) {
        if (!isSafeExternalId(memberId) || memberIds.has(memberId))
          throw new SyncFailure("provider");
        memberIds.add(memberId);
      }
      if (memberIds.size === result.total) return memberIds;
      if (
        result.memberIds.length === 0 ||
        memberIds.size > result.total ||
        offset + result.limit <= offset
      )
        throw new SyncFailure("provider");
      offset += result.limit;
    }
    throw new SyncFailure("provider");
  }

  async function resolveForumUser(
    actorId: string,
    templeId: string,
    member: MemberForSync,
  ): Promise<
    { kind: "found"; user: ForumUser } | { kind: "skip"; reason: string }
  > {
    if (member.discourseUserId !== null) {
      const forumUser = await callMemberProvider(
        actorId,
        templeId,
        member,
        () => options.transport.getUser(member.discourseUserId as number),
      );
      return forumUser
        ? { kind: "found", user: forumUser }
        : {
            kind: "skip",
            reason:
              "an established forum link no longer resolves; the link was retained",
          };
    }
    if (member.emails.length === 0)
      return { kind: "skip", reason: "there is no verified email available" };

    const candidateIds = new Set<number>();
    for (const email of member.emails) {
      const matches = await callMemberProvider(actorId, templeId, member, () =>
        options.transport.findUsersByEmail(email),
      );
      const ids = new Set(
        matches.map((match) => match.id).filter(isSafeExternalId),
      );
      if (ids.size > 1)
        return {
          kind: "skip",
          reason: "a verified email matches multiple forum accounts",
        };
      for (const id of ids) candidateIds.add(id);
    }
    if (candidateIds.size > 1)
      return {
        kind: "skip",
        reason: "the verified emails match different forum accounts",
      };

    const [candidateId] = candidateIds;
    if (candidateId) {
      const forumUser = await callMemberProvider(
        actorId,
        templeId,
        member,
        () => options.transport.getUser(candidateId),
      );
      if (!forumUser)
        return {
          kind: "skip",
          reason: "the matched forum account changed during reconciliation",
        };
      await guardMember(actorId, templeId, member);
      await persistLink(database, member.userId, forumOrigin, forumUser.id);
      return { kind: "found", user: forumUser };
    }

    await guardMember(actorId, templeId, member);
    const concurrentLink = await loadCurrentLink(
      database,
      member.userId,
      forumOrigin,
    );
    if (concurrentLink !== null) {
      const forumUser = await callMemberProvider(
        actorId,
        templeId,
        member,
        () => options.transport.getUser(concurrentLink),
      );
      return forumUser
        ? { kind: "found", user: forumUser }
        : {
            kind: "skip",
            reason:
              "an established forum link no longer resolves; the link was retained",
          };
    }

    const email = member.emails[0];
    const username =
      normalizeForumUsername(member.motto) ??
      normalizeForumUsername(email.split("@", 1)[0]);
    if (!username)
      return { kind: "skip", reason: "a forum username could not be derived" };

    let created: ForumCreateResult;
    try {
      created = await callMemberProvider(actorId, templeId, member, () =>
        options.transport.createUser({
          name: member.displayName,
          email,
          password: createPassword(),
          username,
        }),
      );
    } catch (error) {
      if (error instanceof SyncFailure) throw error;
      return {
        kind: "skip",
        reason:
          "forum account creation had an unresolved outcome; reconciliation is required before retrying",
      };
    }
    if (
      !created.success ||
      !created.userId ||
      !isSafeExternalId(created.userId)
    )
      return {
        kind: "skip",
        reason:
          "forum account creation had an unresolved outcome; reconciliation is required before retrying",
      };

    let forumUser: ForumUser | null;
    try {
      forumUser = await callMemberProvider(actorId, templeId, member, () =>
        options.transport.getUser(created.userId as number),
      );
    } catch (error) {
      if (error instanceof SyncFailure) throw error;
      return {
        kind: "skip",
        reason:
          "forum account creation had an unresolved outcome; reconciliation is required before retrying",
      };
    }
    if (!forumUser)
      return {
        kind: "skip",
        reason:
          "forum account creation had an unresolved outcome; reconciliation is required before retrying",
      };
    await guardMember(actorId, templeId, member);
    await persistLink(database, member.userId, forumOrigin, forumUser.id);
    return { kind: "found", user: forumUser };
  }

  return async function sync(input: {
    expectedActorId: string;
    templeId: string;
  }): Promise<DiscourseSyncState> {
    const progress: string[] = [];
    let completed = 0;
    let skipped = 0;
    let total = 0;
    try {
      if (
        !isCanonicalId(input.expectedActorId) ||
        !isCanonicalId(input.templeId) ||
        forumOrigin !== new URL(forumOrigin).origin ||
        !forumOrigin.startsWith("https://")
      )
        throw new SyncFailure("invalid-request");
      await guard(input.expectedActorId);

      const [temple] = await database
        .select({ id: temples.id })
        .from(temples)
        .where(eq(temples.id, input.templeId));
      if (!temple) throw new SyncFailure("invalid-request");
      const membershipRows = await database
        .select({ id: templeMemberships.id })
        .from(templeMemberships)
        .where(eq(templeMemberships.templeId, input.templeId))
        .orderBy(asc(templeMemberships.addedAt), asc(templeMemberships.id));
      total = membershipRows.length;

      const listedGroups = await loadForumGroups(input.expectedActorId);
      const groups = new Map<number, ForumGroup & { members: Set<number> }>();
      for (const seed of forumGroupSeed) {
        let group = listedGroups.find(
          (candidate) => candidate.name === seed.name,
        );
        if (!group) {
          group = await callProvider(input.expectedActorId, () =>
            options.transport.createGroup(seed),
          );
        }
        await callProvider(input.expectedActorId, () =>
          options.transport.configureGroup(group.id, seed),
        );
        const memberIds = await loadGroupMemberIds(
          input.expectedActorId,
          group.name,
        );
        groups.set(seed.grade, {
          ...group,
          title: seed.title,
          members: memberIds,
        });
      }
      progress.push("Forum grade groups are ready.");

      for (let index = 0; index < membershipRows.length; index += 1) {
        await guard(input.expectedActorId);
        const member = await loadMemberForSync(
          database,
          input.templeId,
          membershipRows[index].id,
          forumOrigin,
        );
        if (!member) {
          skipped += 1;
          progress.push(`Skipped member ${index + 1}: membership changed.`);
          continue;
        }
        if (member.grade < 0 || member.grade > 6) {
          skipped += 1;
          progress.push(`Skipped member ${index + 1}: grade is outside 0–6.`);
          continue;
        }

        const resolved = await resolveForumUser(
          input.expectedActorId,
          input.templeId,
          member,
        );
        if (resolved.kind === "skip") {
          skipped += 1;
          progress.push(`Skipped member ${index + 1}: ${resolved.reason}.`);
          continue;
        }
        const forumUser = resolved.user;
        const motto = normalizeForumUsername(member.motto);
        if (motto && forumUser.username !== motto) {
          await callMemberProvider(
            input.expectedActorId,
            input.templeId,
            member,
            () => options.transport.updateUsername(forumUser.username, motto),
          );
          forumUser.username = motto;
        }

        for (const seed of forumGroupSeed) {
          const group = groups.get(seed.grade);
          if (!group) throw new SyncFailure("provider");
          const present = group.members.has(forumUser.id);
          if (present && seed.grade !== member.grade) {
            await callMemberProvider(
              input.expectedActorId,
              input.templeId,
              member,
              () =>
                options.transport.removeGroupMember(
                  group.id,
                  forumUser.username,
                ),
            );
            group.members.delete(forumUser.id);
          } else if (!present && seed.grade === member.grade) {
            await callMemberProvider(
              input.expectedActorId,
              input.templeId,
              member,
              () =>
                options.transport.addGroupMember(group.id, forumUser.username),
            );
            group.members.add(forumUser.id);
          }
        }

        const gradeGroup = groups.get(member.grade);
        if (!gradeGroup) throw new SyncFailure("provider");
        if (forumUser.primaryGroupId !== gradeGroup.id) {
          await callMemberProvider(
            input.expectedActorId,
            input.templeId,
            member,
            () =>
              options.transport.setPrimaryGroup(forumUser.id, gradeGroup.id),
          );
        }
        if (forumUser.title !== gradeGroup.title && gradeGroup.title) {
          await callMemberProvider(
            input.expectedActorId,
            input.templeId,
            member,
            () =>
              options.transport.setTitle(
                forumUser.username,
                gradeGroup.title as string,
              ),
          );
        }
        completed += 1;
        progress.push(`Synced member ${index + 1} of ${total}.`);
      }

      return {
        status: skipped > 0 ? "warning" : "success",
        message:
          skipped > 0
            ? `Sync completed with ${skipped} member${skipped === 1 ? "" : "s"} skipped.`
            : "Discourse sync completed.",
        progress,
        completed,
        skipped,
        total,
      };
    } catch (error) {
      return {
        status: "error",
        message: safeFailureMessage(error),
        progress,
        completed,
        skipped,
        total,
      };
    }
  };
}
