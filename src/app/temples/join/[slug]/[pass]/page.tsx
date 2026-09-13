import { Button, Container, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";
import { createSqlTempleReader } from "@/temples/sql";
import { joinTempleAction } from "../../../actions";

function signInHref(callbackURL: string) {
  return `/signin?${new URLSearchParams({ callbackURL }).toString()}`;
}

export default async function TemplesJoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; pass: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, pass: joinPass } = await params;
  const callbackURL = `/temples/join/${encodeURIComponent(slug)}/${encodeURIComponent(joinPass)}`;
  const actorId = await getCurrentSqlUserId();
  if (!actorId)
    return (
      <Container sx={{ my: 2 }}>
        <Typography variant="h5">Join Temple</Typography>
        <Typography sx={{ my: 2 }}>
          <Link href={signInHref(callbackURL)}>Sign in</Link> to review and
          confirm this invitation.
        </Typography>
      </Container>
    );
  const preview = await createSqlTempleReader(db).getJoinPreview(
    actorId,
    slug,
    joinPass,
  );
  const query = await searchParams;
  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">Join Temple</Typography>
      {query.error ? (
        <Typography color="error" role="alert" sx={{ my: 2 }}>
          {query.error}
        </Typography>
      ) : null}
      {!preview ? (
        <Typography sx={{ my: 2 }}>
          No temple matches that slug and join code.
        </Typography>
      ) : preview.alreadyMember ? (
        <Typography sx={{ my: 2 }}>
          You are already a member of {preview.temple.name} Temple.
        </Typography>
      ) : (
        <>
          <Typography sx={{ my: 2 }}>
            Confirm that you want to join {preview.temple.name} Temple. Your
            membership will begin at grade 0.
          </Typography>
          <form action={joinTempleAction}>
            <input type="hidden" name="expectedActorId" value={actorId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="joinPass" value={joinPass} />
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained">
                Confirm and join
              </Button>
              <Button component={Link} href="/temples" variant="outlined">
                Cancel
              </Button>
            </Stack>
          </form>
        </>
      )}
      {!preview || preview.alreadyMember ? (
        <Link href="/temples">Back to temples</Link>
      ) : null}
    </Container>
  );
}
