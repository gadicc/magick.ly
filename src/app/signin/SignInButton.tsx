"use client";

import { Alert, Button, Stack } from "@mui/material";
import { useState } from "react";
import { authClient } from "@/auth/client";
import { useLegacyRecoveryGate } from "../clientProviders";

export default function SignInButton({ callbackURL }: { callbackURL: string }) {
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
    </Stack>
  );
}
