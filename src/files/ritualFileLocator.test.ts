import { describe, expect, it } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  formatRitualFileLocator,
  parseRitualFileLocator,
} from "./ritualFileLocator";

const locator = () => ({
  ritualId: createUuidV7(),
  attachmentId: createUuidV7(),
  fileId: createUuidV7(),
});

describe("ritual file locator", () => {
  it("round-trips the exact ritual, attachment and file binding", () => {
    const input = locator();
    const source = formatRitualFileLocator(input);
    expect(source).toBe(
      `/api/files?id=${input.fileId}&ritualId=${input.ritualId}&attachmentId=${input.attachmentId}&mode=download`,
    );
    expect(parseRitualFileLocator(source)).toEqual(input);
  });

  it.each([
    "",
    "/api/files",
    "/api/files?sha256=" + "a".repeat(64),
    "/api/files?id=invalid&ritualId=invalid&attachmentId=invalid&mode=download",
  ])("rejects incomplete or invalid input %#", (value) => {
    expect(parseRitualFileLocator(value)).toBeNull();
  });

  it("rejects alternate encodings, order, duplicate fields and extra capabilities", () => {
    const value = locator();
    const canonical = formatRitualFileLocator(value);
    for (const changed of [
      canonical.replace("?id=", "?%69d="),
      `/api/files?ritualId=${value.ritualId}&id=${value.fileId}&attachmentId=${value.attachmentId}&mode=download`,
      `${canonical}&id=${value.fileId}`,
      `${canonical}&download=1`,
      `https://magick.ly${canonical}`,
      `${canonical}#display`,
      canonical.toUpperCase(),
    ])
      expect(parseRitualFileLocator(changed)).toBeNull();
  });

  it("rejects malformed values when formatting", () => {
    expect(() =>
      formatRitualFileLocator({ ...locator(), fileId: "invalid" }),
    ).toThrow(TypeError);
  });
});
