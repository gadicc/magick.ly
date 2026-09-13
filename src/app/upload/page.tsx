import { Alert, Container, Link as MuiLink, Typography } from "@mui/material";
import Link from "next/link";
import { getCurrentSqlUserId } from "@/auth/session";
import { sqlRitualReader } from "@/doc/sqlRuntime";
import Upload from "@/lib/upload";

export const dynamic = "force-dynamic";

export default async function UploadFilePage() {
  const actorId = await getCurrentSqlUserId();
  if (!actorId)
    return (
      <Container sx={{ my: 3 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          Attach an image to a ritual
        </Typography>
        <Alert severity="info">
          <MuiLink
            component={Link}
            href={`/signin?callbackURL=${encodeURIComponent("/upload")}`}
          >
            Sign in
          </MuiLink>{" "}
          to choose a ritual you can edit.
        </Alert>
      </Container>
    );

  const rituals = (await sqlRitualReader.listMetadata())
    .filter((ritual) => ritual.canEdit)
    .map(({ id, title }) => ({ id, title }));

  return (
    <Container sx={{ my: 3, maxWidth: "sm" }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Attach an image to a ritual
      </Typography>
      <Typography color="text.secondary">
        Choose a ritual you currently edit. The image is stored privately and
        attached to that ritual; uploading it does not create a public file
        link.
      </Typography>
      {rituals.length > 0 ? (
        <Upload expectedActorId={actorId} rituals={rituals} />
      ) : (
        <Alert severity="info" sx={{ mt: 2 }}>
          You do not currently have an editable ritual to attach an image to.
        </Alert>
      )}
    </Container>
  );
}
