import { DefaultSession } from "next-auth";
import { User as DefaultUser } from "next-auth/lib/types";
import type { UserServer } from "@/schemas/user";
import { EnhancedOmit } from "gongo-server-db-mongo/lib/collection";

// https://authjs.dev/getting-started/typescript
declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    ip: string;
    userAgent?: string | null;
    user: {
      id: string;
    } & DefaultSession["user"] &
      EnhancedOmit<User, "_id">;
  }

  /**
   * The shape of the user object returned in the OAuth providers' `profile` callback,
   * or the second parameter of the `session` callback, when using a database.
   */
  interface User extends UserServer, DefaultUser {}

  /**
   * Usually contains information about the provider being used
   * and also extends `TokenSet`, which is different tokens returned by OAuth Providers.
   */
  // interface Account {}

  /** The OAuth profile returned from your provider */
  // interface Profile {}
}
