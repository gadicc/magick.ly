"use client";

import { Container, Typography } from "@mui/material";
import {
  db,
  useGongoLive,
  useGongoSub,
  useGongoUserId,
} from "gongo-client-react";
import React from "react";
import slug from "slug";

import "@/db";

export default function AdminTemplesPage() {
  useGongoSub("templesForAdmins");
  const temples = useGongoLive((db) => db.collection("temples").find());
  const userId = useGongoUserId();
  const [newTempleName, setNewTempleName] = React.useState("");

  function addTemple() {
    if (!userId) return alert("No user id");
    const insertedDoc = db.collection("temples").insert({
      name: newTempleName,
      slug: slug(newTempleName),
      createdBy: userId,
    });
    setNewTempleName("");

    const templeId = insertedDoc._id;
    if (!templeId)
      return alert(
        "Failed to insert temple membership, no temple id in inserted doc",
      );

    db.collection("templeMemberships").insert({
      userId,
      templeId,
      admin: true,
      grade: 0,
      addedAt: new Date(),
    });
  }

  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h5">Temples</Typography>
      <ol>
        {temples.map((temple) => (
          <li key={temple._id} style={{ marginBottom: 5 }}>
            <a href={"/temples/admin/" + temple._id}>{temple.name}</a>
          </li>
        ))}
        <li>
          <input
            type="text"
            value={newTempleName}
            onChange={(e) => setNewTempleName(e.target.value)}
          />{" "}
          <button onClick={addTemple} disabled={!newTempleName}>
            Add
          </button>
        </li>
      </ol>
    </Container>
  );
}
