import { isUuidV7 } from "../lib/ids";

export interface RitualFileLocator {
  ritualId: string;
  attachmentId: string;
  fileId: string;
}

const canonicalId = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();

/**
 * Stable same-origin source reference. The three IDs bind a finalized file to
 * its ritual association; possession of the reference never grants access.
 */
export function formatRitualFileLocator(locator: RitualFileLocator): string {
  if (
    !canonicalId(locator?.ritualId) ||
    !canonicalId(locator?.attachmentId) ||
    !canonicalId(locator?.fileId)
  )
    throw new TypeError("Invalid ritual file locator");
  return `/api/files?id=${locator.fileId}&ritualId=${locator.ritualId}&attachmentId=${locator.attachmentId}&mode=download`;
}

/** Accept only the formatter's exact spelling; URL normalization cannot create identity. */
export function parseRitualFileLocator(
  value: unknown,
): RitualFileLocator | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/api/files?") ||
    value.includes("#") ||
    !value.isWellFormed() ||
    value.includes("\0")
  )
    return null;
  let url: URL;
  try {
    url = new URL(value, "https://ritual-file.invalid");
  } catch {
    return null;
  }
  const ritualId = url.searchParams.get("ritualId");
  const attachmentId = url.searchParams.get("attachmentId");
  const fileId = url.searchParams.get("id");
  if (
    !canonicalId(ritualId) ||
    !canonicalId(attachmentId) ||
    !canonicalId(fileId)
  )
    return null;
  const locator: RitualFileLocator = { ritualId, attachmentId, fileId };
  return formatRitualFileLocator(locator) === value ? locator : null;
}
