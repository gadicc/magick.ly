"use client";

import { Container, Typography } from "@mui/material";
import React from "react";

import Upload, { FileEntry } from "@/lib/upload";

export default function UploadFilePage() {
  const [fileEntry, setFileEntry] = React.useState<FileEntry | null>(null);

  return (
    <Container sx={{ my: 2 }}>
      <Typography variant="h6">Upload File</Typography>
      <Upload
        onResult={(entry: FileEntry) => {
          setFileEntry(entry);
        }}
      />
      {fileEntry && (
        <div>
          <br />
          <b>Uploaded:</b> {fileEntry.filename}, {fileEntry.size} bytes{" "}
          <a
            style={{ textDecoration: "none" }}
            href={"/api/file2?sha256=" + fileEntry.sha256}
          >
            🔗
          </a>
          <br />
          SHA256: {fileEntry.sha256}
        </div>
      )}
      {/*
      {!fileEntry && lesson.audio && (
        <div>
          <br />
          <b>Previously uploaded:</b> {lesson.audio.filename},{" "}
          {lesson.audio.size} bytes, {lesson.audio.duration?.toFixed(2)} seconds
        </div>
      )}
      */}
    </Container>
  );
}
