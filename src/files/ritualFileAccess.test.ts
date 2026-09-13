import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { createRitualFileAuthorizer } from "./ritualFileAccess";
import { formatRitualFileLocator } from "./ritualFileLocator";
import type { RitualFileRecord } from "./repository";

vi.mock("server-only", () => ({}));

const locator = {
  ritualId: createUuidV7(),
  attachmentId: createUuidV7(),
  fileId: createUuidV7(),
};
const record = {
  id: locator.fileId,
  ritualId: locator.ritualId,
  attachmentId: locator.attachmentId,
} as RitualFileRecord;
const rendered = (contentJson: string, canEdit = false) => ({
  ritual: { id: locator.ritualId, canEdit },
  contentJson,
});
const image = (src: string) =>
  JSON.stringify({ children: [{ type: "img", src }] });

describe("private ritual file authorization", () => {
  it("requires the exact locator in the current selected rendered tree", async () => {
    const source = formatRitualFileLocator(locator);
    const getRendered = vi.fn(async () => rendered(image(`${source}#crop`)));
    await expect(
      createRitualFileAuthorizer({ getRendered })(record, locator),
    ).resolves.toBe(true);
    expect(getRendered).toHaveBeenCalledWith(locator.ritualId);
  });

  it("lets a current editor preview a finalized attachment before saving its locator", async () => {
    const getRendered = vi.fn(async () => rendered(image("/other.png"), true));
    await expect(
      createRitualFileAuthorizer({ getRendered })(record, locator),
    ).resolves.toBe(true);
  });

  it("denies pre-save access after editor revocation and to ordinary readers", async () => {
    for (const current of [null, rendered(image("/other.png"), false)])
      await expect(
        createRitualFileAuthorizer({ getRendered: async () => current })(
          record,
          locator,
        ),
      ).resolves.toBe(false);
  });

  it("denies a link, file, or ritual mismatch before reading selected content", async () => {
    const getRendered = vi.fn(async () => rendered(image("unused")));
    const authorize = createRitualFileAuthorizer({ getRendered });
    for (const changed of [
      { ...locator, ritualId: createUuidV7() },
      { ...locator, attachmentId: createUuidV7() },
      { ...locator, fileId: createUuidV7() },
    ])
      await expect(authorize(record, changed)).resolves.toBe(false);
    expect(getRendered).not.toHaveBeenCalled();
  });

  it("denies missing policy access, removed occurrences and malformed selected trees", async () => {
    const source = formatRitualFileLocator(locator);
    for (const current of [
      null,
      rendered(image("/other.png")),
      rendered(
        JSON.stringify({
          children: [{ type: "img", src: source, srcSet: "unsafe" }],
        }),
      ),
    ])
      await expect(
        createRitualFileAuthorizer({ getRendered: async () => current })(
          record,
          locator,
        ),
      ).resolves.toBe(false);
  });
});
