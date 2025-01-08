import NextAuth, { Session } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import gs from "@/api-lib/db"; // -full
import GongoAuthAdapter, { AdapterUser } from "@/api-lib/gongoAuthAdapter";
import { ipFromReq } from "@/api-lib/ipCheck";
import { ObjectId } from "bson";

interface Service {
  service: string;
  id: string;
  profile: {
    id: string;
    displayName: string;
    name?: {
      familyName: string;
      givenName: string;
    };
    emails: { value: string; verified: boolean }[];
    photos: { value: string }[];
    provider: string;
    _json: Record<string, unknown>;
  };
}

function newUserFromService<T extends Record<string, unknown>>(
  service: Service,
  overrides: T = {} as T
) {
  const _id = new ObjectId();

  return {
    _id,
    id: _id.toHexString(),

    displayName: service.profile.displayName,
    name: service.profile.name
      ? service.profile.name.givenName + " " + service.profile.name.familyName
      : service.profile.displayName,
    emails: service.profile.emails,
    email: service.profile.emails[0].value,
    emailVerified: service.profile.emails[0].verified,
    photos: service.profile.photos,
    image: service.profile.photos[0].value,
    services: [service],
    createdAt: new Date(),
    ...overrides,
  };
}

export const { auth, handlers, signIn, signOut } = NextAuth((req) => {
  return {
    adapter: GongoAuthAdapter(gs),

    callbacks: {
      async session({
        session,
        user,
      }: {
        session: Session;
        user: AdapterUser;
      }) {
        session.user.id = user.id;

        if (req) {
          await gs.dba.collection("sessions").updateOne(
            {
              userId: new ObjectId(user.id),
              expires: new Date(session.expires),
            },
            {
              $set: {
                ip: ipFromReq(req),
                userAgent:
                  req.headers instanceof Headers
                    ? req.headers.get("user-agent")
                    : req.headers["user-agent"],
              },
            }
          );
        }

        return session;
      },
    },

    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        profile(profile) {
          const service: Service = {
            service: "google",
            id: profile.sub,
            profile: {
              id: profile.sub,
              displayName: profile.name,
              name: {
                familyName: profile.family_name,
                givenName: profile.given_name,
              },
              emails: [
                { value: profile.email, verified: profile.email_verified },
              ],
              photos: [{ value: profile.picture }],
              provider: "google",
              _json: profile,
            },
          };

          const user = newUserFromService(service, {
            name: profile.name, // <-- full name in one string
          });

          console.log("profile() user", user);
          return user;

          // Hack since this gets added in a later step
          // return user as typeof user & { _id: ObjectId };
        },
      }),
    ],
  };
});
