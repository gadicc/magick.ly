import Discourse from "discourse2";
import { z } from "zod";
import { db, ObjectId } from "@/api-lib/db";
import { auth } from "@/auth";
import type { TempleMembershipServer, UserServer } from "@/schemas";
import { publicProcedure } from "../trpc";

const discourse = new Discourse("https://forums.magick.ly", {
  "Api-Key": process.env.DISCOURSE_API_KEY,
  "Api-Username": "system",
});

const Users = db.collection<UserServer>("users");

export const discourseSync = publicProcedure
  .input(z.object({ templeId: z.string() }))
  .mutation(async function* ({ input: { templeId: templeIdStr } }) {
    const session = await auth();
    if (!session) return yield { message: "No session" };

    const { user } = session;
    if (!user) return yield { message: "Not logged in" };
    if (!user?.admin) return yield { message: "Not an admin" };

    const templeId = new ObjectId(templeIdStr);

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

    // 3. Look through dbUsers and sync with discourse
    for (const dbUser of users) {
      console.log("dbUser", dbUser);

      // 4. Find or create a discourse user
      let user;
      if (dbUser.discourseId) {
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
            user = users[0];
            break;
          }
        }
      } else {
        const result = await discourse.createUser({
          name: dbUser.displayName,
          email: dbUser.emails[0].value,
          password: "XXX",
          username:
            dbUser.membership?.motto?.replace(/\s/g, "_") || dbUser.displayName,
          active: true,
          approved: true,
          // title: highest grade...
        });
        console.log("result", result);
      }

      if (false && user && !dbUser.discourseId) {
        await db
          .collection("users")
          .updateOne({ _id: dbUser._id }, { $set: { discourseId: user.id } });
      }

      console.log("user", user);
    }

    /*
    const users = await db.collection("users").find().toArray();
    for (const user of users) {
      if (user.discourseUsername) {
        await discourse.syncGroups(user.discourseUsername, user.groupIds);
      }
    }
    */
    return yield { message: "Complete" };
  });
