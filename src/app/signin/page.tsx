import { Container, Typography } from "@mui/material";
import { safeAuthCallbackURL } from "@/auth/callbackURL";
import SignInButton from "./SignInButton";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string; callbackUrl?: string }>;
}) {
  const query = await searchParams;
  const callbackURL = safeAuthCallbackURL(
    query.callbackURL ?? query.callbackUrl,
  );
  return (
    <Container maxWidth="sm" sx={{ my: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Sign in to Magickly
      </Typography>
      <Typography sx={{ mb: 3 }}>
        Use the same Google account as before to find your temples, rituals and
        study progress.
      </Typography>
      <SignInButton callbackURL={callbackURL} />
    </Container>
  );
}
