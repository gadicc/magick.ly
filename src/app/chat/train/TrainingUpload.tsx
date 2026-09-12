"use client";

import { useState } from "react";
import { FilePond } from "react-filepond";
import "filepond/dist/filepond.min.css";

export default function TrainingUpload() {
  const [message, setMessage] = useState("");
  return (
    <>
      <p>Upload one text-based PDF, up to 4 MiB, to the shared chat corpus.</p>
      <FilePond
        name="filepond"
        allowMultiple={false}
        allowRevert={false}
        credits={false}
        server={{
          process: {
            url: "/chat/train/upload",
            method: "POST",
            onload: (response) => {
              const result = JSON.parse(response);
              setMessage(`Indexed ${result.chunks} chunks.`);
              return result.sourceId;
            },
            onerror: (response) => {
              let errorMessage = "Upload failed. Please try again.";
              try {
                errorMessage = JSON.parse(response).message || errorMessage;
              } catch {
                // A proxy may return a non-JSON error response.
              }
              setMessage(errorMessage);
              return errorMessage;
            },
          },
          revert: null,
        }}
      />
      <p role="status">{message}</p>
    </>
  );
}
