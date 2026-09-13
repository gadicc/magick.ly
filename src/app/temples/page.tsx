import { Button, Container, Stack, TextField, Typography } from "@mui/material";
import Link from "next/link";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";
import { createSqlTempleReader } from "@/temples/sql";
import { startTempleJoin } from "./actions";

function signInHref(callbackURL: string) {
  return `/signin?${new URLSearchParams({ callbackURL }).toString()}`;
}

export default async function TemplePage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const actorId = await getCurrentSqlUserId();
  const query = await searchParams;
  const templeList = actorId
    ? await createSqlTempleReader(db).getMyTemples(actorId)
    : [];

  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">My Temples</Typography>
      {!actorId ? (
        <Typography sx={{ my: 2 }}>
          <Link href={signInHref("/temples")}>Sign in</Link> to see your temple
          memberships or join an organization.
        </Typography>
      ) : templeList.length === 0 ? (
        <Typography sx={{ my: 2 }}>
          You are not currently a member of any temples.
        </Typography>
      ) : (
        <ul>
          {templeList.map((temple) => (
            <li key={temple.id}>
              {temple.name} (grade {temple.membership.grade}
              {temple.membership.admin ? (
                <>
                  , <Link href={`/temples/admin/${temple.id}`}>admin</Link>
                </>
              ) : null}
              )
            </li>
          ))}
        </ul>
      )}

      {query.joined ? (
        <Typography color="success.main" sx={{ my: 2 }} role="status">
          Your temple membership is active.
        </Typography>
      ) : null}
      {query.error ? (
        <Typography color="error" sx={{ my: 2 }} role="alert">
          {query.error}
        </Typography>
      ) : null}

      {actorId ? (
        <>
          <Typography variant="h5" sx={{ mt: 4 }}>
            Join an existing temple
          </Typography>
          <Typography sx={{ my: 1 }}>
            Enter the slug and private join code supplied by that organization.
            You will review the temple name before membership is created.
          </Typography>
          <form action={startTempleJoin}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                name="slug"
                size="small"
                label="Temple slug"
                required
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
              <TextField
                name="joinPass"
                size="small"
                label="Join code"
                type="password"
                required
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
              <Button type="submit" variant="contained">
                Continue
              </Button>
            </Stack>
          </form>

          <Typography variant="h5" sx={{ mt: 4 }}>
            Create a new temple
          </Typography>
          <Typography sx={{ my: 1 }}>
            Creating a temple starts a new organization that you administer. It
            does not request membership in an existing organization.
          </Typography>
          <Button component={Link} href="/temples/admin" variant="outlined">
            Create or manage temples
          </Button>
        </>
      ) : null}
    </Container>
  );
}
