import { Container, Typography } from "@mui/material";
import Link from "next/link";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";
import { createUuidV7 } from "@/lib/ids";
import { privateMetadata } from "@/seo/metadata";
import { createSqlTempleReader } from "@/temples/sql";
import { CreateTempleForm } from "../CreateTempleForm";

export const metadata = privateMetadata("Temple Administration");

function signInHref() {
  return `/signin?${new URLSearchParams({ callbackURL: "/temples/admin" }).toString()}`;
}

export default async function AdminTemplesPage() {
  const actorId = await getCurrentSqlUserId();
  if (!actorId)
    return (
      <Container sx={{ my: 2 }}>
        <Typography variant="h5">Temples</Typography>
        <Typography sx={{ mt: 2 }}>
          <Link href={signInHref()}>Sign in</Link> to create or administer a
          temple.
        </Typography>
      </Container>
    );

  const manageable =
    await createSqlTempleReader(db).getManageableTemples(actorId);
  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">Temples you administer</Typography>
      {manageable.temples.length ? (
        <ol>
          {manageable.temples.map((temple) => (
            <li key={temple.id} style={{ marginBottom: 5 }}>
              <Link href={`/temples/admin/${temple.id}`}>{temple.name}</Link>
            </li>
          ))}
        </ol>
      ) : (
        <Typography sx={{ my: 2 }}>
          You do not currently administer any temples.
        </Typography>
      )}
      {manageable.globalAdmin ? (
        <Typography variant="body2" sx={{ mb: 3 }}>
          Your global administrator grant allows you to manage every temple.
        </Typography>
      ) : null}

      <Typography variant="h5" sx={{ mt: 4 }}>
        Create a new temple
      </Typography>
      <Typography sx={{ my: 1 }}>
        This creates a separate organization and makes you its first
        administrator. To join an existing temple, use its slug and join code on
        the <Link href="/temples">My Temples page</Link>.
      </Typography>
      <CreateTempleForm actorId={actorId} operationId={createUuidV7()} />
    </Container>
  );
}
