import {
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";
import { createSqlTempleReader } from "@/temples/sql";
import { updateTempleMembershipAction } from "../../../../actions";

function signInHref(callbackURL: string) {
  return `/signin?${new URLSearchParams({ callbackURL }).toString()}`;
}

export default async function TemplesAdminEditMembershipPage({
  params,
  searchParams,
}: {
  params: Promise<{ _id: string; membershipId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { _id, membershipId } = await params;
  const callbackURL = `/temples/admin/${encodeURIComponent(_id)}/membership/${encodeURIComponent(membershipId)}`;
  const actorId = await getCurrentSqlUserId();
  if (!actorId)
    return (
      <Container sx={{ my: 2 }}>
        <Typography>
          <Link href={signInHref(callbackURL)}>Sign in</Link> to edit this
          membership.
        </Typography>
      </Container>
    );
  const view = await createSqlTempleReader(db).getAdminMembership(
    actorId,
    _id,
    membershipId,
  );
  if (!view)
    return (
      <Container sx={{ my: 2 }}>
        <Typography>
          This membership was not found, or you cannot manage its temple.
        </Typography>
        <Link href="/temples/admin">Back to temple administration</Link>
      </Container>
    );
  const query = await searchParams;
  const { temple, membership } = view;

  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">Edit Membership</Typography>
      <Typography sx={{ my: 1 }}>
        {membership.displayName} in {temple.name} Temple
      </Typography>
      {query.error ? (
        <Typography color="error" role="alert" sx={{ my: 2 }}>
          {query.error}
        </Typography>
      ) : null}
      <form action={updateTempleMembershipAction}>
        <input type="hidden" name="expectedActorId" value={actorId} />
        <input type="hidden" name="templeId" value={temple.id} />
        <input
          type="hidden"
          name="membershipId"
          value={membership.membershipId}
        />
        <Stack spacing={2} sx={{ maxWidth: 640, mt: 2 }}>
          <TextField
            name="motto"
            label="Motto"
            defaultValue={membership.motto ?? ""}
            multiline
            slotProps={{ htmlInput: { maxLength: 10_000 } }}
          />
          <TextField
            name="grade"
            type="number"
            label="Grade"
            defaultValue={membership.grade}
            required
            slotProps={{ htmlInput: { min: 0, max: 6, step: 1 } }}
            helperText="Golden Dawn grade, from 0 through 6."
          />
          <FormControlLabel
            control={
              <Checkbox
                name="admin"
                value="true"
                defaultChecked={membership.admin}
              />
            }
            label="Temple administrator"
          />
          <TextField
            name="memberSince"
            type="date"
            label="Member since"
            defaultValue={membership.memberSince?.toISOString().slice(0, 10)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Optional. Clear the field if the date is unknown."
          />
          <Stack direction="row" spacing={1}>
            <Button type="submit" variant="contained">
              Save membership
            </Button>
            <Button
              component={Link}
              href={`/temples/admin/${temple.id}`}
              variant="outlined"
            >
              Cancel
            </Button>
          </Stack>
        </Stack>
      </form>
    </Container>
  );
}
