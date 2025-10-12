"use server";
import { createStreamableValue } from "@ai-sdk/rsc";
import Discourse from "discourse2";
import { db, ObjectId } from "@/api-lib/db";
import { auth } from "@/auth";
import type { TempleMembershipServer, UserServer } from "@/schemas";

if (!process.env.DISCOURSE_API_KEY) {
  throw new Error("DISCOURSE_API_KEY not set");
}

const DISCOURSE_URL = "https://forums.magick.ly";

const discourse = new Discourse(DISCOURSE_URL, {
  "Api-Key": process.env.DISCOURSE_API_KEY,
  "Api-Username": "system",
});

const Users = db.collection<UserServer>("users");

const groupSeed = [
  {
    name: "neophytes",
    full_name: "Neophytes",
    title: "Neophyte",
    grade: 0,
  },
  {
    name: "zelators",
    full_name: "Zelators",
    title: "Zelator",
    grade: 1,
  },
  {
    name: "theorici",
    full_name: "Theorici",
    title: "Theoricus",
    grade: 2,
  },
  {
    name: "practici",
    full_name: "Practici",
    title: "Practicus",
    grade: 3,
  },
  {
    name: "philosophi",
    full_name: "Philosophi",
    title: "Philosophus",
    grade: 4,
  },
  {
    name: "adepti-minores",
    full_name: "Adepti Minores",
    title: "Adeptus Minor",
    grade: 5,
  },
  {
    name: "adepti-majores",
    full_name: "Adepti Majores",
    title: "Adeptus Major",
    grade: 6,
  },
];

function normalizeMotto(motto?: string) {
  const MAX_USERNAME_LENGTH = 20;
  if (!motto) return null;

  motto = motto.trim().replace(/\s+/g, "_");
  if (motto.length > MAX_USERNAME_LENGTH) {
    const pos = motto.lastIndexOf("_", MAX_USERNAME_LENGTH);
    if (pos > 0) motto = motto.substring(0, pos);
    else motto = motto.substring(0, MAX_USERNAME_LENGTH);
  }
  return motto;
}

export async function discourseSync({
  templeId: templeIdStr,
}: {
  templeId: string;
}) {
  const stream = createStreamableValue({ message: "Starting..." });
  const msg = (m: string) => stream.update({ message: m });
  const updateDone = (x) => {
    stream.update(x);
    stream.done();
  };

  (async () => {
    const session = await auth();
    if (!session) return updateDone({ message: "No session" });

    const { user } = session;
    if (!user) return updateDone({ message: "Not logged in" });
    if (!user?.admin) return updateDone({ message: "Not an admin" });

    const templeId = new ObjectId(templeIdStr);

    const allGroups = (await discourse.listGroups()).groups;
    const groups = await Promise.all(
      groupSeed.map(async (seed) => {
        let group = allGroups.find((group) => group.name === seed.name);
        if (!group) {
          msg(`Creating discourse group "${seed.name}".`);
          const result = await discourse.createGroup(
            {
              group: {
                name: seed.name,
                full_name: seed.full_name,
                visibility_level: 2,
                // @ts-expect-error: it does exist
                members_visibility_level: 2,
                primary_group: true,
              },
            },
            { validateParams: false },
          );
          // console.log("result", result);
          // @ts-expect-error: fine for now
          group = result.basic_group;
        }
        if (!group) throw new Error("No group found or created");

        msg(`Asserting group "${group.name}".`);

        await discourse.updateGroup(
          {
            id: group!.id,
            group: {
              name: seed.name,
              full_name: seed.full_name,
              // @ts-expect-error: fine for now
              title: seed.title,
              // automatic: false,
              mentionable_level: 3,
              messageable_level: 3,
              visibility_level: 2,
              primary_group: true,
              public_admission: false,
              public_exit: false,
              allow_membership_requests: false,
              default_notification_level: 3,
              // is_group_user: false,
              members_visibility_level: 2,
              // can_see_members: true,
              // can_admin_group: true,
              // can_edit_group: true,
              // publish_read_state: false,
            },
          },
          { validateParams: false },
        );
        const members = (await discourse.listGroupMembers({ id: group.name }))
          .members;

        return { ...group, grade: seed.grade, members };
      }),
    );
    // console.log("groups", groups);

    // 1. Get all memberships for this temple
    const memberships = await db
      .collection<TempleMembershipServer>("templeMemberships")
      .find({ templeId })
      .toArray();

    const membershipMap = new Map(
      memberships.map((m) => [m.userId.toHexString(), m]),
    );

    // 2. Get users with those memberships and left join
    const users = (
      await Users.find({
        _id: { $in: memberships.map((m) => m.userId) },
      }).toArray()
    ).map((user) => ({
      ...user,
      membership: membershipMap.get(user._id.toHexString()),
    }));
    msg(`Found ${users.length} users with temple memberships.`);

    // 3. Look through dbUsers and sync with discourse
    for (let userI = 0; userI < users.length; userI++) {
      const dbUser = users[userI];
      const motto = normalizeMotto(dbUser.membership?.motto);

      // console.log("dbUser", dbUser);
      msg(
        `Processing user ${userI + 1}/${users.length}: ${dbUser.displayName} (grade ${dbUser.membership?.grade})`,
      );

      // 4. Find or create a discourse user
      let user: Awaited<ReturnType<typeof discourse.adminGetUser>> | null =
        null;
      if (dbUser.discourseId) {
        msg(`- has existing discourse id "${dbUser.discourseId}"`);
        user = await discourse.adminGetUser({ id: dbUser.discourseId });
      } else if (dbUser.emails.length) {
        for (const email of dbUser.emails) {
          const users = await discourse.adminListUsers({
            flag: "active",
            email: email.value,
          });

          if (users.length) {
            if (users.length > 1) {
              console.warn(
                "Multiple users with email",
                email.value,
                "using first match",
              );
            }
            // user = users[0];
            user = await discourse.adminGetUser({ id: users[0].id });
            msg(`- found discourse user by email ${email.value}`);
            break;
          }
        }
      }
      if (!user) {
        msg(`- creating new discourse user: `);
        const result = await discourse.createUser({
          name: dbUser.displayName,
          email: dbUser.emails[0].value,
          password: crypto.randomUUID(),
          username: motto || dbUser.displayName,
          active: true,
          approved: true,
        });
        console.log("result", result);
        if (result.success) {
          const _user = await discourse.getUser({
            username: motto || dbUser.displayName,
          });
          console.log("_user", _user);
          user = await discourse.adminGetUser({ id: _user.user.id });
          console.log("user", user);
        }
      }
      if (!user) {
        throw new Error("Could not find or create discourse user" + dbUser._id);
      }

      if (user && !dbUser.discourseId) {
        msg(`- linking local user to discourse user ${user.id}`);
        await db
          .collection("users")
          .updateOne({ _id: dbUser._id }, { $set: { discourseId: user.id } });
      }
      // console.log("user", user);

      if (user.username !== motto && motto) {
        msg(`- updating username to "${motto}"`);
        await discourse.updateUsername({
          username: user.username,
          new_username: motto,
        });
        user.username = motto;
      }

      const grade = dbUser.membership?.grade;
      if (!grade && grade !== 0) {
        msg(`- user ${dbUser._id.toHexString()} has no grade, skipping...`);
        continue;
      }

      for (let i = 0; i < groups.length; i++) {
        const group = groups.find((g) => g.grade === i);
        if (!group) throw new Error("No group for grade " + i);
        const userInGroup = group.members.some((m) => m.id === user?.id);
        // const userGroup = user?.groups?.find((g) => g.id === group.id);
        // console.log({ group, userGroup });

        if (userInGroup && i > grade) {
          msg(
            `- removing user ${user?.username} from group ${group.name} (${group.id})`,
          );
          await discourse.removeGroupMembers({
            id: group.id,
            usernames: user!.username,
          });
        } else if (!userInGroup && i <= grade) {
          msg(
            `- adding user ${user?.username} to group ${group.name} (${group.id})`,
          );
          await discourse.addGroupMembers({
            id: group.id,
            usernames: user!.username,
          });
        }

        if (i === grade) {
          const data = [
            {
              endpoint: "primary_group",
              field: "primary_group_id",
              value: group.id,
            },
          ];

          for (const { endpoint, field, value } of data) {
            if (user[field] !== value) {
              msg(`- setting "${field}" to "${value}"`);
              const response = await fetch(
                `${DISCOURSE_URL}/admin/users/${user!.id}/${endpoint}`,
                {
                  method: "PUT",
                  headers: {
                    "Api-Key": process.env.DISCOURSE_API_KEY!,
                    "Api-Username": "system",
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: new URLSearchParams({
                    [field]: value.toString(),
                  }),
                },
              );
              // console.log("response", response.status, await response.text());
              if (!response.ok) {
                console.error(
                  `Error setting ${field}`,
                  response.status,
                  await response.text(),
                );
              }
            }
          }

          if (user.title !== group.title) {
            msg(`- setting title to "${group.title}"`);
            await discourse.updateUser(
              {
                username: user.username,
                // @ts-expect-error: fine for now
                title: group.title,
              },
              { validateParams: false },
            );
          }
        }
      }
    }

    /*
      const users = await db.collection("users").find().toArray();
      for (const user of users) {
        if (user.discourseUsername) {
          await discourse.syncGroups(user.discourseUsername, user.groupIds);
        }
      }
      */
    return updateDone({ message: "Complete." });
  })().catch((err) => {
    console.error(err);
    stream.update({ message: "Error: " + err.message });
    stream.done();
  });

  return stream.value;
}
