import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";

vi.mock("server-only", () => ({}));

const parent = {
  id: "01994a00-0000-7000-8000-000000000001",
  currentRevisionId: "01994a00-0000-7000-8000-000000000002",
  version: 7,
  currentCompiledArtifactId: null as string | null,
};
const artifactId = "01994a00-0000-7000-8000-000000000003";
const selected = { contentSha256: "a".repeat(64) };
const hash = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

describe("shared ritual render descriptor v1", () => {
  // Fixed digests of the prior checker array: profile, parent, revision, version,
  // artifact (including null), selected content hash, output format and version.
  it.each([
    [null, "fb417daa84f1689a0dbf3764f88b3ae2c7f2d0ed10681765dfb31b4923307095"],
    [
      artifactId,
      "f18202c6c1d23132973302c49ac7d91e65db098989b90732bd42a2da46491629",
    ],
  ])(
    "preserves the exact existing digest with artifact %s",
    (artifact, digest) => {
      const result = createRitualRenderDescriptor(
        { ...parent, currentCompiledArtifactId: artifact },
        selected,
      );
      expect(result).toEqual({
        descriptorSha256: digest,
        contentSha256: selected.contentSha256,
        outputFormat: "json-rich-text",
        outputFormatVersion: "1",
      });
      expect(Object.keys(result)).toEqual([
        "descriptorSha256",
        "contentSha256",
        "outputFormat",
        "outputFormatVersion",
      ]);
    },
  );

  it.each([
    ["id", "01994a00-0000-7000-8000-000000000004"],
    ["currentRevisionId", "01994a00-0000-7000-8000-000000000005"],
    ["version", 0],
    ["version", 8],
    ["currentCompiledArtifactId", artifactId],
  ] as const)(
    "binds changed parent %s=%s even when content stays identical",
    (key, value) => {
      const original = createRitualRenderDescriptor(parent, selected),
        changed = createRitualRenderDescriptor(
          { ...parent, [key]: value },
          selected,
        );
      expect(changed.descriptorSha256).not.toBe(original.descriptorSha256);
      expect(changed.contentSha256).toBe(original.contentSha256);
    },
  );

  it("binds exact selected content hashes without normalizing source bytes", () => {
    const content = '{"value":"é 🌍"}\r\n',
      variants = [
        content,
        content.replace("\r\n", "\n"),
        "\uFEFF" + content,
        content.normalize("NFD"),
      ];
    const results = variants.map((contentJson) =>
      createRitualRenderDescriptor(parent, {
        contentSha256: hash(contentJson),
      }),
    );
    expect(new Set(results.map((result) => result.descriptorSha256)).size).toBe(
      variants.length,
    );
    expect(results.map((result) => result.contentSha256)).toEqual(
      variants.map(hash),
    );
  });

  it("does not read or expose source, selected JSON, identity tokens or unrelated metadata", () => {
    const privateParent = {
        ...parent,
        title: "private ritual title",
        creatorId: "private creator",
      },
      privateSelected = { ...selected };
    const readSource = vi.fn(() => {
      throw Error("Source must not be read");
    });
    Object.defineProperty(privateParent, "source", { get: readSource });
    Object.defineProperty(privateSelected, "contentJson", { get: readSource });
    const result = createRitualRenderDescriptor(privateParent, privateSelected);
    expect(result).toEqual(createRitualRenderDescriptor(parent, selected));
    expect(readSource).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /private|01994a00|source|contentJson|currentRevisionId|artifactId/,
    );
  });

  it("preserves frozen inputs and returns independent descriptors", () => {
    const fixedParent = Object.freeze({ ...parent }),
      fixedSelected = Object.freeze({ ...selected }),
      expected = createRitualRenderDescriptor(fixedParent, fixedSelected),
      changed = createRitualRenderDescriptor(fixedParent, fixedSelected);
    changed.contentSha256 = "changed";
    changed.descriptorSha256 = "changed";
    expect(createRitualRenderDescriptor(fixedParent, fixedSelected)).toEqual(
      expected,
    );
    expect(fixedParent).toEqual(parent);
    expect(fixedSelected).toEqual(selected);
  });
});
