import { AdminPanelSettings, Edit } from "@mui/icons-material";
import {
  Container,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";
import { privateMetadata } from "@/seo/metadata";
import { canRunDiscourseSync } from "@/temples/discourseSync";
import { createSqlTempleReader } from "@/temples/sql";
import { DiscourseSyncButton } from "./DiscourseSyncButton";
import { InviteManager } from "./InviteManager";

export const metadata = privateMetadata("Manage Temple");

function signInHref(callbackURL: string) {
  return `/signin?${new URLSearchParams({ callbackURL }).toString()}`;
}

export default async function AdminTemplePage({
  params,
  searchParams,
}: {
  params: Promise<{ _id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { _id } = await params;
  const callbackURL = `/temples/admin/${encodeURIComponent(_id)}`;
  const actorId = await getCurrentSqlUserId();
  if (!actorId)
    return (
      <Container sx={{ my: 2 }}>
        <Typography>
          <Link href={signInHref(callbackURL)}>Sign in</Link> to administer this
          temple.
        </Typography>
      </Container>
    );
  const temple = await createSqlTempleReader(db).getAdminTemple(actorId, _id);
  if (!temple)
    return (
      <Container sx={{ my: 2 }}>
        <Typography>
          This temple was not found, or you cannot manage it.
        </Typography>
        <Link href="/temples/admin">Back to temple administration</Link>
      </Container>
    );
  const query = await searchParams;
  const showDiscourseSync = await canRunDiscourseSync(db, actorId);
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">{temple.name} Temple</Typography>
      {query.error ? (
        <Typography color="error" role="alert" sx={{ my: 2 }}>
          {query.error}
        </Typography>
      ) : null}

      <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
        Members
      </Typography>
      <TableContainer component={Paper}>
        <Table aria-label={`${temple.name} members`}>
          <TableHead>
            <TableRow>
              <TableCell width={80}>Grade</TableCell>
              <TableCell>Name or motto</TableCell>
              <TableCell>Added</TableCell>
              <TableCell width={50}>Edit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {temple.members.map((member) => (
              <TableRow key={member.membershipId}>
                <TableCell>
                  {member.grade}{" "}
                  {member.admin ? (
                    <AdminPanelSettings
                      aria-label="Temple administrator"
                      fontSize="small"
                      sx={{ verticalAlign: "bottom" }}
                    />
                  ) : null}
                </TableCell>
                <TableCell>{member.motto || member.displayName}</TableCell>
                <TableCell>{date.format(member.addedAt)}</TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    aria-label={`Edit ${member.displayName}`}
                    href={`/temples/admin/${temple.id}/membership/${member.membershipId}`}
                  >
                    <Edit fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
        Join information
      </Typography>
      <Typography sx={{ mb: 2 }}>Temple slug: {temple.slug}</Typography>
      <InviteManager
        actorId={actorId}
        templeId={temple.id}
        templeName={temple.name}
        slug={temple.slug}
        joinPass={temple.joinPass}
      />
      {showDiscourseSync ? (
        <DiscourseSyncButton actorId={actorId} templeId={temple.id} />
      ) : null}
    </Container>
  );
}
