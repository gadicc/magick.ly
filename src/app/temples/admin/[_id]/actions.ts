"use server";

import Discourse, { HTTPError } from "discourse2";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";
import {
  canRunDiscourseSync,
  createSqlDiscourseSync,
  type DiscourseSyncState,
  type DiscourseSyncTransport,
  initialDiscourseSyncState,
  MAGICKLY_DISCOURSE_ORIGIN,
} from "@/temples/discourseSync";

function safeId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Invalid Discourse response");
  return value;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Discourse response");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  if (typeof value !== "string" || !value)
    throw new Error("Invalid Discourse response");
  return value;
}

function nullableStringValue(value: unknown) {
  if (value === null) return null;
  return stringValue(value);
}

function createDiscourseTransport(apiKey: string): DiscourseSyncTransport {
  const discourse = new Discourse(MAGICKLY_DISCOURSE_ORIGIN, {
    "Api-Key": apiKey,
    "Api-Username": "system",
  });

  return {
    async listGroupsPage(page) {
      const url = new URL("/groups.json", MAGICKLY_DISCOURSE_ORIGIN);
      url.searchParams.set("page", page.toString());
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        headers: {
          "Api-Key": apiKey,
          "Api-Username": "system",
        },
      });
      if (!response.ok) throw new Error("Discourse group list failed");
      const payload = objectValue(await response.json());
      if (!Array.isArray(payload.groups))
        throw new Error("Invalid Discourse response");
      return {
        groups: payload.groups.map((value) => {
          const group = objectValue(value);
          return {
            id: safeId(Number(group.id)),
            name: stringValue(group.name),
            title: nullableStringValue(group.title),
          };
        }),
      };
    },

    async createGroup(seed) {
      const result = await discourse.createGroup(
        {
          group: {
            name: seed.name,
            full_name: seed.fullName,
            visibility_level: 2,
            primary_group: true,
          },
        },
        { validateParams: false },
      );
      return {
        id: safeId(result.basic_group.id),
        name: result.basic_group.name,
        title: result.basic_group.title,
      };
    },

    async configureGroup(groupId, seed) {
      const group = {
        name: seed.name,
        full_name: seed.fullName,
        title: seed.title,
        mentionable_level: 3,
        messageable_level: 3,
        visibility_level: 2,
        primary_group: true,
        public_admission: false,
        public_exit: false,
        allow_membership_requests: false,
        default_notification_level: 3,
        members_visibility_level: 2,
      };
      await discourse.updateGroup(
        { id: safeId(groupId), group } as Parameters<
          typeof discourse.updateGroup
        >[0],
        { validateParams: false },
      );
    },

    async listGroupMemberPage(groupName, offset) {
      const url = new URL(
        `/groups/${encodeURIComponent(groupName)}/members.json`,
        MAGICKLY_DISCOURSE_ORIGIN,
      );
      url.searchParams.set("offset", offset.toString());
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        headers: {
          "Api-Key": apiKey,
          "Api-Username": "system",
        },
      });
      if (!response.ok) throw new Error("Discourse group member list failed");
      const payload = objectValue(await response.json());
      const meta = objectValue(payload.meta);
      if (!Array.isArray(payload.members))
        throw new Error("Invalid Discourse response");
      return {
        memberIds: payload.members.map((value) =>
          safeId(Number(objectValue(value).id)),
        ),
        total: Number(meta.total),
        limit: Number(meta.limit),
        offset: Number(meta.offset),
      };
    },

    async getUser(userId) {
      try {
        const result = await discourse.adminGetUser({ id: safeId(userId) });
        return {
          id: safeId(result.id),
          username: result.username,
          title: result.title,
          primaryGroupId: result.primary_group_id,
        };
      } catch (error) {
        if (error instanceof HTTPError && error.status === 404) return null;
        throw error;
      }
    },

    async findUsersByEmail(email) {
      const result = await discourse.adminListUsers({
        flag: "active",
        email,
      });
      return result.map((candidate) => ({ id: safeId(candidate.id) }));
    },

    async createUser(input) {
      const result = await discourse.createUser({
        name: input.name,
        email: input.email,
        password: input.password,
        username: input.username,
        active: true,
        approved: true,
      });
      return {
        success: result.success,
        userId: result.user_id ? safeId(result.user_id) : null,
      };
    },

    async updateUsername(username, newUsername) {
      await discourse.updateUsername({ username, new_username: newUsername });
    },

    async addGroupMember(groupId, username) {
      await discourse.addGroupMembers({
        id: safeId(groupId),
        usernames: username,
      });
    },

    async removeGroupMember(groupId, username) {
      await discourse.removeGroupMembers({
        id: safeId(groupId),
        usernames: username,
      });
    },

    async setPrimaryGroup(userId, groupId) {
      const response = await fetch(
        `${MAGICKLY_DISCOURSE_ORIGIN}/admin/users/${safeId(userId)}/primary_group`,
        {
          method: "PUT",
          redirect: "error",
          headers: {
            "Api-Key": apiKey,
            "Api-Username": "system",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            primary_group_id: safeId(groupId).toString(),
          }),
        },
      );
      if (!response.ok)
        throw new Error("Discourse primary group update failed");
    },

    async setTitle(username, title) {
      await discourse.updateUser(
        { username, title } as Parameters<typeof discourse.updateUser>[0],
        { validateParams: false },
      );
    },
  };
}

export async function discourseSync(
  _previous: DiscourseSyncState,
  formData: FormData,
): Promise<DiscourseSyncState> {
  const expectedActorId = formData.get("actorId");
  const templeId = formData.get("templeId");
  if (typeof expectedActorId !== "string" || typeof templeId !== "string")
    return {
      ...initialDiscourseSyncState,
      status: "error",
      message: "The sync request is invalid.",
    };

  const currentActorId = await getCurrentSqlUserId();
  if (
    currentActorId !== expectedActorId ||
    !(await canRunDiscourseSync(db, currentActorId))
  )
    return {
      ...initialDiscourseSyncState,
      status: "error",
      message: "Global administrator access is required.",
    };

  const apiKey = process.env.DISCOURSE_API_KEY;
  if (!apiKey)
    return {
      ...initialDiscourseSyncState,
      status: "error",
      message: "Discourse sync is not configured.",
    };

  return createSqlDiscourseSync(db, {
    getCurrentActorId: getCurrentSqlUserId,
    transport: createDiscourseTransport(apiKey),
  })({ expectedActorId, templeId });
}
