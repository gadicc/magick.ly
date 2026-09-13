"use client";

import { sha256Hex } from "@gadicc/loom/files/hash";
import {
  Alert,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import React from "react";
import { formatRitualFileLocator } from "../files/ritualFileLocator";
import {
  RITUAL_IMAGE_TYPES,
  RITUAL_UPLOAD_MAX_BYTES,
  type RitualUploadCode,
  type RitualUploadInitiateResult,
  type RitualUploadReceipt,
  type RitualUploadResult,
} from "../files/ritualUploadProtocol";
import { createUuidV7, isUuidV7 } from "./ids";

export interface EditableRitualOption {
  id: string;
  title: string;
}

interface Attempt {
  key: string;
  operationId: string;
}

const codes = new Set<RitualUploadCode>([
  "INVALID_REQUEST",
  "AUTH_REQUIRED",
  "ACTOR_CHANGED",
  "FORBIDDEN",
  "EXPIRED",
  "BUSY",
  "NOT_UPLOADED",
  "TOO_LARGE",
  "SIZE_MISMATCH",
  "DIGEST_MISMATCH",
  "UNSUPPORTED_TYPE",
  "UNSUPPORTED_ANIMATION",
  "INVALID_IMAGE",
  "IMAGE_LIMIT",
  "DUPLICATE",
  "ABORTED",
  "TIMEOUT",
  "UNAVAILABLE",
  "OPERATION_CONFLICT",
]);

const failure = (
  code: RitualUploadCode,
  retryable = false,
): Extract<RitualUploadResult, { ok: false }> => ({
  ok: false,
  code,
  retryable,
});

function parsedFailure(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === false &&
    codes.has((value as { code: RitualUploadCode }).code) &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  )
    return value as Extract<RitualUploadResult, { ok: false }>;
  return null;
}

function receipt(value: unknown): value is RitualUploadReceipt {
  if (!value || typeof value !== "object") return false;
  const result = value as RitualUploadReceipt;
  return (
    [
      result.operationId,
      result.actorId,
      result.ritualId,
      result.fileId,
      result.attachmentId,
    ].every(isUuidV7) &&
    /^[a-f0-9]{64}$/.test(result.sha256) &&
    Number.isSafeInteger(result.byteSize) &&
    result.byteSize > 0 &&
    RITUAL_IMAGE_TYPES.includes(result.contentType) &&
    Number.isSafeInteger(result.completedAtMs)
  );
}

async function command(
  url: string,
  input: unknown,
  fetcher: typeof fetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.json();
}

/** One retryable browser attempt. Callers retain operationId after any uncertain response. */
export async function uploadRitualImage(input: {
  expectedActorId: string;
  ritualId: string;
  operationId: string;
  file: File;
  fetcher?: typeof fetch;
}): Promise<RitualUploadResult> {
  const fetcher = input.fetcher ?? fetch;
  if (
    !isUuidV7(input.expectedActorId) ||
    !isUuidV7(input.ritualId) ||
    !isUuidV7(input.operationId) ||
    !RITUAL_IMAGE_TYPES.includes(
      input.file.type as (typeof RITUAL_IMAGE_TYPES)[number],
    )
  )
    return failure("UNSUPPORTED_TYPE");
  if (input.file.size < 1 || input.file.size > RITUAL_UPLOAD_MAX_BYTES)
    return failure("TOO_LARGE");
  try {
    const sha256 = await sha256Hex(await input.file.arrayBuffer());
    const request = {
      version: 1 as const,
      operationId: input.operationId,
      expectedActorId: input.expectedActorId,
      ritualId: input.ritualId,
      filename: input.file.name,
      byteSize: input.file.size,
      contentType: input.file.type,
      sha256,
    };
    const initiated = (await command(
      "/api/files/ritual/initiate",
      request,
      fetcher,
    )) as RitualUploadInitiateResult;
    const initiateFailure = parsedFailure(initiated);
    if (initiateFailure) return initiateFailure;
    if (!initiated || !initiated.ok || !("state" in initiated))
      return failure("UNAVAILABLE", true);
    if (initiated.state === "completed") {
      if (
        !receipt(initiated.receipt) ||
        initiated.replayed !== true ||
        initiated.receipt.operationId !== input.operationId ||
        initiated.receipt.actorId !== input.expectedActorId ||
        initiated.receipt.ritualId !== input.ritualId ||
        initiated.receipt.sha256 !== sha256 ||
        initiated.receipt.byteSize !== input.file.size ||
        initiated.receipt.contentType !== input.file.type
      )
        return failure("UNAVAILABLE", true);
      return initiated;
    }
    if (
      initiated.upload.kind !== "presigned-put" ||
      !/^https:\/\//.test(initiated.upload.url) ||
      !Number.isSafeInteger(initiated.upload.expiresAtMs) ||
      initiated.upload.expiresAtMs <= Date.now() ||
      !initiated.upload.headers ||
      typeof initiated.upload.headers !== "object"
    )
      return failure("UNAVAILABLE", true);
    const uploaded = await fetcher(initiated.upload.url, {
      method: "PUT",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: initiated.upload.headers,
      body: input.file,
    });
    if (!uploaded.ok && uploaded.status !== 412)
      return failure(
        "UNAVAILABLE",
        [403, 408, 409, 425, 429].includes(uploaded.status) ||
          uploaded.status >= 500,
      );
    const finalized = (await command(
      "/api/files/ritual/finalize",
      {
        version: 1,
        operationId: input.operationId,
        expectedActorId: input.expectedActorId,
      },
      fetcher,
    )) as RitualUploadResult;
    const finalizeFailure = parsedFailure(finalized);
    if (finalizeFailure) return finalizeFailure;
    if (
      !finalized ||
      !finalized.ok ||
      !receipt(finalized.receipt) ||
      finalized.receipt.operationId !== input.operationId ||
      finalized.receipt.actorId !== input.expectedActorId ||
      finalized.receipt.ritualId !== input.ritualId ||
      finalized.receipt.sha256 !== sha256 ||
      finalized.receipt.byteSize !== input.file.size ||
      finalized.receipt.contentType !== input.file.type
    )
      return failure("UNAVAILABLE", true);
    return finalized;
  } catch {
    return failure("UNAVAILABLE", true);
  }
}

function message(result: Extract<RitualUploadResult, { ok: false }>) {
  if (result.code === "AUTH_REQUIRED" || result.code === "ACTOR_CHANGED")
    return "Your sign-in changed. Refresh the page before retrying.";
  if (result.code === "FORBIDDEN")
    return "You no longer have permission to edit this ritual.";
  if (result.code === "TOO_LARGE")
    return "Choose an image no larger than 20 MiB.";
  if (
    [
      "UNSUPPORTED_TYPE",
      "UNSUPPORTED_ANIMATION",
      "INVALID_IMAGE",
      "IMAGE_LIMIT",
    ].includes(result.code)
  )
    return "Choose a valid PNG, JPEG, GIF, or WebP image.";
  if (result.code === "DUPLICATE") return "That image is already stored.";
  return result.retryable
    ? "The upload could not be confirmed. Retry to resume the same upload."
    : "The image could not be uploaded.";
}

export default function Upload({
  expectedActorId,
  rituals,
  onResult,
}: {
  expectedActorId: string;
  rituals: EditableRitualOption[];
  onResult?: (result: RitualUploadReceipt) => void;
}) {
  const [ritualId, setRitualId] = React.useState(rituals[0]?.id ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [result, setResult] = React.useState<RitualUploadResult | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const inFlight = React.useRef(false);
  const sourceReference = result?.ok
    ? formatRitualFileLocator({
        ritualId: result.receipt.ritualId,
        attachmentId: result.receipt.attachmentId,
        fileId: result.receipt.fileId,
      })
    : null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !file || !ritualId) return;
    inFlight.current = true;
    const key = `${ritualId}\0${file.name}\0${file.size}\0${file.type}\0${file.lastModified}`;
    const current =
      attempt?.key === key ? attempt : { key, operationId: createUuidV7() };
    setAttempt(current);
    setIsUploading(true);
    try {
      const next = await uploadRitualImage({
        expectedActorId,
        ritualId,
        operationId: current.operationId,
        file,
      });
      setResult(next);
      if (next.ok) onResult?.(next.receipt);
    } finally {
      inFlight.current = false;
      setIsUploading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FormControl fullWidth margin="normal">
        <InputLabel id="ritual-upload-label">Ritual</InputLabel>
        <Select
          labelId="ritual-upload-label"
          label="Ritual"
          value={ritualId}
          disabled={isUploading}
          onChange={(event) => {
            if (inFlight.current) return;
            setRitualId(event.target.value);
            setAttempt(null);
            setResult(null);
          }}
        >
          {rituals.map((ritual) => (
            <MenuItem key={ritual.id} value={ritual.id}>
              {ritual.title}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <input
        aria-label="Image file"
        type="file"
        accept={RITUAL_IMAGE_TYPES.join(",")}
        required
        disabled={isUploading}
        onChange={(event) => {
          if (inFlight.current) return;
          setFile(event.target.files?.[0] ?? null);
          setAttempt(null);
          setResult(null);
        }}
      />
      <Button type="submit" variant="contained" disabled={isUploading || !file}>
        {isUploading
          ? "Uploading…"
          : result && !result.ok && result.retryable
            ? "Retry upload"
            : "Upload and attach"}
      </Button>
      {result && !result.ok && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {message(result)}
        </Alert>
      )}
      {result?.ok && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Image attached to the selected ritual. Insert this source reference in
          an image block:
          <TextField
            fullWidth
            margin="dense"
            value={sourceReference}
            slotProps={{
              htmlInput: {
                "aria-label": "Ritual image source reference",
                readOnly: true,
              },
            }}
          />
          <Button
            size="small"
            onClick={() => {
              if (sourceReference)
                void navigator.clipboard?.writeText(sourceReference);
            }}
          >
            Copy source reference
          </Button>
        </Alert>
      )}
    </form>
  );
}

export type { RitualUploadReceipt, RitualUploadResult };
