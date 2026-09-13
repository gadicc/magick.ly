"use client";

import { ContentCopy, Visibility, VisibilityOff } from "@mui/icons-material";
import {
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { QRCode } from "react-qrcode";
import { updateTempleInviteAction } from "../../actions";

export function InviteManager({
  actorId,
  templeId,
  templeName,
  slug,
  joinPass,
}: {
  actorId: string;
  templeId: string;
  templeName: string;
  slug: string;
  joinPass: string | null;
}) {
  const [visible, setVisible] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");
  const joinPath = joinPass
    ? `/temples/join/${encodeURIComponent(slug)}/${encodeURIComponent(joinPass)}`
    : "";
  useEffect(() => {
    setJoinUrl(joinPath ? `${location.origin}${joinPath}` : "");
  }, [joinPath]);

  return (
    <Stack spacing={2}>
      <form action={updateTempleInviteAction}>
        <input type="hidden" name="expectedActorId" value={actorId} />
        <input type="hidden" name="templeId" value={templeId} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField
            name="joinPass"
            label="Join code"
            size="small"
            type={visible ? "text" : "password"}
            defaultValue={joinPass ?? ""}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <IconButton
            type="button"
            aria-label={visible ? "Hide join code" : "Show join code"}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? <VisibilityOff /> : <Visibility />}
          </IconButton>
          <Button type="submit" variant="outlined">
            Save join code
          </Button>
        </Stack>
      </form>
      <Typography variant="body2">
        Clear the code and save to disable new invitations.
      </Typography>
      {joinUrl ? (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <QRCode value={joinUrl} aria-label={`Join ${templeName}`} />
          <div>
            <Typography component="div" sx={{ overflowWrap: "anywhere" }}>
              {visible
                ? joinUrl
                : `${location.origin}/temples/join/${slug}/••••`}
            </Typography>
            <IconButton
              type="button"
              aria-label="Copy invitation link"
              onClick={() => navigator.clipboard.writeText(joinUrl)}
            >
              <ContentCopy />
            </IconButton>
          </div>
        </Stack>
      ) : (
        <Typography>Set a join code to create an invitation link.</Typography>
      )}
    </Stack>
  );
}
