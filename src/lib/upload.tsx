import React from "react";
import type {
  FileEntry,
  FileError,
} from "@/app/api/file2/createFileFromBuffer";
import { sha256bytes } from "./sha256";

export default function Upload({
  onResult,
  onError,
}: {
  onResult?: (result: FileEntry) => void;
  onError?: (error: FileError) => void;
}) {
  const ref = React.useRef<HTMLFormElement>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [fileEntry, setFileEntry] = React.useState<FileEntry | null>(null);
  const [fileError, setFileError] = React.useState<FileError | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsUploading(true);
    const form = ref.current as HTMLFormElement;
    const file = form.querySelector("input[type=file]") as HTMLInputElement;
    const sha256 = form.querySelector("input[name=sha256]") as HTMLInputElement;
    const reader = new FileReader();
    reader.onload = async function () {
      const arrayBuffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      sha256.value = await sha256bytes(bytes);
      console.log("sha256", sha256.value);

      // preflight to make sure file isn't previously uploaded
      let response = await fetch(
        "/api/file2?return=meta&sha256=" + sha256.value,
      );
      let result = (await response.json()) as FileEntry | FileError;

      if ("$error" in result) {
        result = result as FileError;
        if (result.$error.code === "ENOENT") {
          // form.submit();
          response = await fetch("/api/file2", {
            method: "POST",
            body: new FormData(form),
          });

          result = (await response.json()) as FileEntry | FileError;
          console.log("result", result);
        }
      }

      setIsUploading(false);
      if ("$error" in result) {
        setFileError(result as FileError);
        if (onError) onError(result as FileError);
      } else {
        setFileEntry(result);
        if (onResult) onResult(result);
      }
    };
    reader.readAsArrayBuffer(file.files![0]);
    return false;
  }

  return (
    <>
      <form ref={ref} action="/api/file2" onSubmit={onSubmit}>
        <input type="file" name="file" required />
        <input type="hidden" name="sha256" />
        <input type="submit" disabled={isUploading} value="Upload" />
      </form>
      {fileError && (
        <div style={{ color: "red" }}>{JSON.stringify(fileError)}</div>
      )}
      {fileEntry && (
        <div>
          Type: {fileEntry.type}, {fileEntry.size} bytes
          {fileEntry.type === "audio" && (
            <span>, {fileEntry?.audio?.duration?.toFixed(2)}s</span>
          )}
        </div>
      )}
    </>
  );
}

export { FileEntry, FileError };
