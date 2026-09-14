import type {
  BetterAuthLocalTestLoginIdentity,
  BetterAuthLocalTestLoginProvisionContext,
} from "@gadicc/loom/next/auth";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/neonFull";
import { account, user } from "@/db/schema/auth";
import { sqlAuthCutoverReady } from "./cutoverReadiness";
import { LOCAL_ACCEPTANCE_USERS } from "./localTestIdentities";

type MagickliLocalTestIdentity = BetterAuthLocalTestLoginIdentity & {
  id: string;
  role: (typeof LOCAL_ACCEPTANCE_USERS)[number]["role"];
};

const [creator, reader, admin] = LOCAL_ACCEPTANCE_USERS;

/** Fixed identities prepared by the dedicated local acceptance seeder. */
export const MAGICKLI_LOCAL_TEST_IDENTITIES = {
  admin: {
    ...admin,
    defaultCallbackURL: "/admin",
  },
  creator: {
    ...creator,
    defaultCallbackURL: "/temples",
  },
  reader: {
    ...reader,
    defaultCallbackURL: "/study",
  },
} as const satisfies Record<string, MagickliLocalTestIdentity>;

export const MAGICKLI_LOCAL_TEST_FIXTURE_SETUP_REQUIRED =
  "LOCAL_TEST_FIXTURE_SETUP_REQUIRED";

export class MagickliLocalTestFixtureSetupError extends Error {
  constructor() {
    super(
      `${MAGICKLI_LOCAL_TEST_FIXTURE_SETUP_REQUIRED}: run pnpm local-acceptance:seed first`,
    );
    this.name = "MagickliLocalTestFixtureSetupError";
  }
}

type MagickliLocalTestLoginContext = BetterAuthLocalTestLoginProvisionContext<
  keyof typeof MAGICKLI_LOCAL_TEST_IDENTITIES,
  (typeof MAGICKLI_LOCAL_TEST_IDENTITIES)[keyof typeof MAGICKLI_LOCAL_TEST_IDENTITIES]
>;

function fixtureSetupRequired(): never {
  throw new MagickliLocalTestFixtureSetupError();
}

/**
 * Rotate only the credential for one exact preseeded identity.
 *
 * User creation and every application grant, including global admin, remain
 * exclusively owned by the dedicated local acceptance fixture.
 */
export async function provisionMagickliLocalTestIdentity({
  identity,
  passwordHash,
}: MagickliLocalTestLoginContext): Promise<void> {
  if (!(await sqlAuthCutoverReady())) fixtureSetupRequired();

  await db.transaction(async (tx) => {
    const [fixtureUser] = await tx
      .select({ email: user.email, id: user.id })
      .from(user)
      .where(and(eq(user.id, identity.id), eq(user.email, identity.email)))
      .limit(1);
    if (
      fixtureUser?.id !== identity.id ||
      fixtureUser.email !== identity.email
    ) {
      fixtureSetupRequired();
    }

    const [existingCredential] = await tx
      .select({ id: account.id, userId: account.userId })
      .from(account)
      .where(
        and(
          eq(account.providerId, "credential"),
          eq(account.accountId, identity.id),
        ),
      )
      .limit(1);
    if (existingCredential && existingCredential.userId !== identity.id) {
      fixtureSetupRequired();
    }

    const updatedAt = new Date();
    await tx
      .insert(account)
      .values({
        accountId: identity.id,
        password: passwordHash,
        providerId: "credential",
        updatedAt,
        userId: identity.id,
      })
      .onConflictDoUpdate({
        target: [account.providerId, account.accountId],
        set: { password: passwordHash, updatedAt },
      });
  });
}
