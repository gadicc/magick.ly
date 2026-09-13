"use client";

import { Alert, Button, Stack } from "@mui/material";
import { useState } from "react";
import { authClient } from "@/auth/client";

export default function SignInButton({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signIn() {
    if (pending) return;
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
      <Button variant="contained" onClick={signIn} disabled={pending}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </Button>
    </Stack>
  );
}
