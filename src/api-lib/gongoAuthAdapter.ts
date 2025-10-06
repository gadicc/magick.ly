// Modified version of official MongoDBAdapter commit 87298a015058fbc3f5d7127f0a27de2a7d504f99
// https://raw.githubusercontent.com/nextauthjs/next-auth/main/packages/adapter-mongodb/src/index.ts

import { ObjectId } from "bson";
import { WithId } from "gongo-client/lib/browser/Collection";
import GongoServerless from "gongo-server";
import MongoDBA from "gongo-server-db-mongo";
import {
  EnhancedOmit,
  GongoDocument,
} from "gongo-server-db-mongo/lib/collection";
import type {
  Adapter,
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken,
} from "next-auth/adapters";
import { UserServer } from "../schemas";

// https://github.com/microsoft/TypeScript/issues/54451
type MappedOmit<T, K extends keyof T> = {
  [P in keyof T as P extends K ? never : P]: T[P];
};

type ServerDocument<T> = GongoDocument &
  EnhancedOmit<T, "_id"> & { _id: ObjectId };

type MongoAdapterUser = MappedOmit<AdapterUser, "_id"> & { _id: ObjectId };
type MongoAdapterAccount = Omit<AdapterAccount, "userId"> & {
  userId: ObjectId;
};
type MongoAdapterSession = Omit<AdapterSession, "userId"> & {
  userId: ObjectId;
};

/** This is the interface of the MongoDB adapter options. */
export interface MongoDBAdapterOptions {
  /**
   * The name of the {@link https://www.mongodb.com/docs/manual/core/databases-and-collections/#collections MongoDB collections}.
   */
  collections?: {
    Users?: string;
    Accounts?: string;
    Sessions?: string;
    VerificationTokens?: string;
  };
  /**
   * The name you want to give to the MongoDB database
   */
  // databaseName?: string;
}

export const defaultCollections: Required<
  Required<MongoDBAdapterOptions>["collections"]
> = {
  Users: "users",
  Accounts: "accounts",
  Sessions: "sessions",
  VerificationTokens: "verification_tokens",
};

export const format = {
  /** Takes a mongoDB object and returns a plain old JavaScript object */
  from<T = Record<string, unknown>>(
    object: Record<string, unknown> | WithId<GongoDocument>,
  ): T {
    const newObject: Record<string, unknown> = {};
    for (const key in object) {
      const value = object[key];
      if (key === "_id") {
        newObject.id = value.toHexString();
      } else if (key === "userId") {
        newObject[key] = value.toHexString();
      } else {
        newObject[key] = value;
      }
    }
    return newObject as T;
  },
  /** Takes a plain old JavaScript object and turns it into a mongoDB object */
  to<T = Record<string, unknown>>(object: Record<string, unknown>) {
    const newObject: Record<string, unknown> = {
      _id: _id(object.id as string),
    };
    for (const key in object) {
      const value = object[key];
      if (key === "userId") newObject[key] = _id(value as string);
      else if (key === "id") continue;
      else newObject[key] = value;
    }
    return newObject as T & { _id: ObjectId };
  },
};

/** @internal */
export function _id(hex?: string) {
  if (hex?.length !== 24) return new ObjectId();
  return new ObjectId(hex);
}

export default function GongoAuthAdapter(
  // client: Promise<MongoClient>,
  gs: GongoServerless<MongoDBA>,
  options: MongoDBAdapterOptions = {},
): Adapter {
  const { collections } = options;
  const { from, to } = format;

  const db = (async () => {
    if (!gs.dba) throw new Error("no gs.dba");
    const _db = await gs.dba?.dbPromise; // .db(options.databaseName);
    const c = { ...defaultCollections, ...collections };
    return {
      U: _db.collection<MongoAdapterUser>(c.Users),
      A: _db.collection<MongoAdapterAccount>(c.Accounts),
      S: _db.collection<MongoAdapterSession>(c.Sessions),
      V: _db.collection<VerificationToken>(c?.VerificationTokens),
    };
  })();

  return {
    // -------------------------------- USERS --------------------------------

    /*
    async createUser(data) {
      const user = to<AdapterUser>(data);
      await (await db).U.insertOne(user);
      return from<AdapterUser>(user);
    },
    */

    async createUser(
      data: MappedOmit<AdapterUser, "id">,
    ): Promise<AdapterUser> {
      console.log("createUser data", data);

      if (!gs.dba) throw new Error("no gs.dba");
      const _id = data._id ?? new ObjectId();
      const id = _id.toHexString();

      if (data.id && data.id !== id) {
        console.log("Warning: Replacing id", data.id, "with", id);
      }

      const user: AdapterUser = {
        // @ts-expect-error: fine for now
        emails: [],
        // @ts-expect-error: fine for now
        services: [],

        ...data,

        id: _id.toHexString(),
      };

      console.log("createUser user", user);

      const result = await (await db).U.insertOne({
        // @ts-expect-error: fine for now
        _id,
        ...user,
      });

      if (!result.acknowledged) {
        throw new Error(
          "Unexpected mongo result in createUser():" + JSON.stringify(result),
        );
      }

      return user;

      /*
      return {
        id: user._id.toHexString(),
        name: user.name,
        email: user.emails[0].value,
        emailVerified: null, // we have verified but as bool not Date
        image: user.photos[0].value,
      };
      */
    },

    /*
    async getUser(id) {
      const user = await (await db).U.findOne({ _id: _id(id) });
      if (!user) return null;
      return from<AdapterUser>(user);
    },
    */
    async getUser(id: string | ObjectId) {
      if (!gs.dba) throw new Error("no gs.dba");
      const _id = typeof id === "string" ? new ObjectId(id) : id;
      const user = await gs.dba.Users.users.findOne({ _id });
      return user ? from<AdapterUser>(user) : null;
    },

    async getUserByEmail(email) {
      // const user = await (await db).U.findOne({ email });
      const user = await (await db).U.findOne({ "emails.value": email });
      if (!user) return null;
      return from<AdapterUser>(user);
    },

    async getUserByAccount(provider_providerAccountId) {
      const account = await (await db).A.findOne(provider_providerAccountId);
      if (!account) {
        // Try old scheme... TODO, migrate!
        const user = await gs.dba
          .collection<ServerDocument<UserServer>>("users")
          .findOne({
            "services.service": provider_providerAccountId.provider,
            "services.id": provider_providerAccountId.providerAccountId,
          });
        if (user) {
          console.log("found oldschool user", user);
          const service = user.services.find(
            (s) => s.service === provider_providerAccountId.provider,
          )!;
          const account = {
            provider: service.service,
            type: "oauth",
            providerAccountId: service.id,
            // @ts-expect-error: that's correct, it doesn't exist anymore
            access_token: service.accessToken,
            token_type: "bearer",
            scope: (function () {
              switch (service.service) {
                case "github":
                  return "read:user,user:email";
              }
            })(),
            userId: user._id,
          };
          /*
          // Remove accessToken
          await gs.dba.collection("users").updateOne({ _id: user._id}, {
            $unset: {
          })
          */
          await gs.dba.collection("accounts").insertOne(account);
        } else return null;

        return from<AdapterUser>(user);
      }

      if (!account) return null;
      const user = await (await db).U.findOne({
        _id: new ObjectId(account.userId),
      });
      if (!user) return null;
      return from<AdapterUser>(user);
    },
    /*
    async getUserByAccount({ providerAccountId, provider }) {
      if (!gs.dba) throw new Error("no gs.dba");
      const user = gs.dba.Users.users.findOne({
        $and: [
          { "services.services": provider },
          { "services.id": providerAccountId },
        ],
      });
      return from<AdapterUser>(user);
      /*
      return await gs.dba.Users.findOrCreateService(
        "email",
        provider,
        "profile",
        "accessToken",
        "refreshToken",
      )
      */
    /*
    },
    */

    async updateUser(data) {
      const { _id, ...user } = to<AdapterUser>(data);

      const result = await (await db).U.findOneAndUpdate(
        { _id },
        { $set: user },
        { returnDocument: "after", includeResultMetadata: true },
      );

      return from<AdapterUser>(result.value!);
    },

    async deleteUser(id) {
      const userId = _id(id);
      const m = await db;
      await Promise.all([
        // @ts-expect-error: another day (multiple ObjectId types)
        m.A.deleteMany({ userId: userId }),
        m.S.deleteMany({ userId: userId }),
        m.U.deleteOne({ _id: userId }),
      ]);
    },

    // ------------------------------- ACCOUNTS -------------------------------

    linkAccount: async (data) => {
      const account = to<MongoAdapterAccount>(data);
      await (await db).A.insertOne(account);
      return from<AdapterAccount>(account);
    },
    async unlinkAccount(provider_providerAccountId) {
      const { value: account } = await (await db).A.findOneAndDelete(
        provider_providerAccountId,
        {
          includeResultMetadata: true,
        },
      );
      return from<AdapterAccount>(account!);
    },

    // ------------------------------- SESSIONS -------------------------------

    async getSessionAndUser(sessionToken) {
      const session = await (await db).S.findOne({ sessionToken });
      if (!session) return null;
      const user = await (await db).U.findOne({
        _id: new ObjectId(session.userId),
      });
      if (!user) return null;
      return {
        user: from<AdapterUser>(user),
        session: from<AdapterSession>(session),
      };
    },

    async createSession(data) {
      console.log("createSession", data);
      const session = to<MongoAdapterSession>(data);
      await (await db).S.insertOne(session);
      return from<AdapterSession>(session);
    },

    async updateSession(data) {
      const { _id, ...session } = to<MongoAdapterSession>(data);

      const result = await (await db).S.findOneAndUpdate(
        { sessionToken: session.sessionToken },
        { $set: session },
        { returnDocument: "after", includeResultMetadata: true },
      );
      return from<AdapterSession>(result.value!);
    },

    async deleteSession(sessionToken) {
      const { value: session } = await (await db).S.findOneAndDelete(
        {
          sessionToken,
        },
        { includeResultMetadata: true },
      );
      return from<AdapterSession>(session!);
    },

    // ------------------------------- TOKENS -------------------------------

    async createVerificationToken(data) {
      // await (await db).V.insertOne(to(data));
      await (await db).V.insertOne(data);
      return data;
    },

    async useVerificationToken(identifier_token) {
      const { value: verificationToken } = await (await db).V.findOneAndDelete(
        identifier_token,
        { includeResultMetadata: true },
      );

      if (!verificationToken) return null;
      // @ts-expect-error: ok
      delete verificationToken._id;
      return verificationToken;
    },
  };
}

export type {
  Adapter,
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken,
};
