"use client";

import { Alert, Button, Stack, Typography } from "@mui/material";
import { useActionState } from "react";
import { discourseSync } from "./actions";

const initialState = {
  status: "idle" as const,
  message: "",
  progress: [],
  completed: 0,
  skipped: 0,
  total: 0,
};

export function DiscourseSyncButton({
  actorId,
  templeId,
}: {
  actorId: string;
  templeId: string;
}) {
  const [state, action, pending] = useActionState(discourseSync, initialState);
  return (
    <Stack spacing={1} sx={{ mt: 4, alignItems: "flex-start" }}>
      <Typography variant="h6">Discourse</Typography>
      <Typography>
        Synchronize this temple&apos;s members with the forum grade groups. The
        page will show the result when the sync finishes.
      </Typography>
      <form action={action}>
        <input type="hidden" name="actorId" value={actorId} />
        <input type="hidden" name="templeId" value={templeId} />
        <Button type="submit" variant="outlined" disabled={pending}>
          {pending ? "Synchronizing…" : "Synchronize with Discourse"}
        </Button>
      </form>
      {pending ? (
        <Alert severity="info">Discourse sync is running.</Alert>
      ) : null}
      {!pending && state.status !== "idle" ? (
        <Alert
          severity={
            state.status === "error"
              ? "error"
              : state.status === "warning"
                ? "warning"
                : "success"
          }
        >
          {state.message}
        </Alert>
      ) : null}
      {!pending && state.progress.length > 0 ? (
        <ol aria-label="Discourse sync results">
          {state.progress.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ol>
      ) : null}
    </Stack>
  );
}
