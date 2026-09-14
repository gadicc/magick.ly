"use client";

import { Alert, Button, Divider, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { authClient } from "@/auth/client";
import { useLegacyRecoveryGate } from "../clientProviders";

export default function SignInButton({
  callbackURL,
  localTestLoginEnabled = false,
}: {
  callbackURL: string;
  localTestLoginEnabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const recovery = useLegacyRecoveryGate();
  async function signIn() {
    if (pending || recovery.state !== "ready") return;
    setPending(true);
    setFailed(false);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
      if (result.error) throw new Error("Sign-in unavailable");
    } catch {
      setFailed(true);
      setPending(false);
    }
  }
  return (
    <Stack spacing={2}>
      {failed && (
        <Alert severity="error">
          We could not start sign-in. Check your connection and try again.
        </Alert>
      )}
      <Button
        variant="contained"
        onClick={signIn}
        disabled={pending || recovery.state !== "ready"}
      >
        {pending ? "Opening Google…" : "Continue with Google"}
      </Button>
      {localTestLoginEnabled && (
        <>
          <Divider>Local development</Divider>
          <Typography variant="body2">
            Uses the fixed identities prepared by pnpm local-acceptance:seed.
          </Typography>
          <form action="/api/dev/test-login" method="post">
            <input name="callbackURL" type="hidden" value={callbackURL} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button
                disabled={recovery.state !== "ready"}
                name="identity"
                type="submit"
                value="creator"
              >
                Creator
              </Button>
              <Button
                disabled={recovery.state !== "ready"}
                name="identity"
                type="submit"
                value="reader"
              >
                Reader
              </Button>
              <Button
                disabled={recovery.state !== "ready"}
                name="identity"
                type="submit"
                value="admin"
              >
                Test admin
              </Button>
            </Stack>
          </form>
        </>
      )}
    </Stack>
  );
}
