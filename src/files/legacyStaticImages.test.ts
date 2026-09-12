import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";
import { legacyStaticImageAliases } from "./legacyStaticImages";

it.each(Object.entries(legacyStaticImageAliases))(
  "keeps a decodable public PNG target for %s",
  async (_source, target) => {
    const bytes = await readFile(
      new URL("../../public" + target, import.meta.url),
    );
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("png");
    const decoded = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info.width).toBeGreaterThan(0);
    expect(decoded.info.height).toBeGreaterThan(0);
    expect(decoded.data.length).toBe(
      decoded.info.width * decoded.info.height * decoded.info.channels,
    );
  },
);
