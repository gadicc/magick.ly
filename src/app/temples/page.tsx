"use client";
import { Button, Container, TextField, Typography } from "@mui/material";
import {
  db,
  useGongoLive,
  useGongoSub,
  useGongoUserId,
} from "gongo-client-react";
import React from "react";

export default function TemplePage() {
  const userId = useGongoUserId();
  useGongoSub("userTemplesAndMemberships");
  const memberships = useGongoLive((db) =>
    db.collection("templeMemberships").find({ userId }),
  );
  const temples = React.useMemo(
    () =>
      memberships.map((membership) => ({
        ...db.collection("temples").findOne({ _id: membership.templeId }),
        membership,
      })),
    [memberships],
  );
  const [slug, setSlug] = React.useState("");
  const [joinPass, setJoinPass] = React.useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = "/temples/join/" + slug + "/" + joinPass;
    location.href = url;
  }

  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">My Temples</Typography>
      {temples.length === 0 ? (
        <p>You are not currently a member of any temples.</p>
      ) : (
        <ul>
          {temples.map((temple) => (
            <li key={temple._id}>
              {temple.name} (grade {temple.membership.grade}
              {temple.membership.admin ? (
                <span>
                  , <a href={"/temples/admin/" + temple._id}>admin</a>
                </span>
              ) : (
                ""
              )}
              )
            </li>
          ))}
        </ul>
      )}

      <br />

      <Typography variant="h5">Join a Temple</Typography>
      <p>
        If your temple uses Magick.ly services, they&apos;ll provide you with
        the following:
      </p>
      <form onSubmit={onSubmit}>
        <TextField
          size="small"
          label="Temple slug"
          sx={{ marginBottom: 1 }}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <br />
        <TextField
          size="small"
          label="Password"
          sx={{ marginBottom: 1.5 }}
          value={joinPass}
          onChange={(e) => setJoinPass(e.target.value)}
        />
        <br />
        <Button type="submit" variant="contained">
          Join
        </Button>
      </form>
      <br />
    </Container>
  );
}
