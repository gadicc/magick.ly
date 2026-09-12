import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RWSPath, tarotDeck } from "./tarot";

describe("tarot package integration", () => {
  it("exposes the card lookup API used by the Kabbalah path page", () => {
    expect(tarotDeck.getByRank(0)).toMatchObject({
      rank: 0,
      name: "The Fool",
      suit: "major",
    });
    expect(tarotDeck.getByRank("21")).toMatchObject({
      rank: 21,
      name: "The World",
      suit: "major",
    });
    expect(tarotDeck.majorArcana).toHaveLength(22);
  });

  it.each([
    { rank: 0, filename: "RWS_Tarot_00_Fool.jpg" },
    { rank: "1", filename: "RWS_Tarot_01_Magician.jpg" },
    { rank: 8, filename: "RWS_Tarot_08_Strength.jpg" },
    { rank: "20", filename: "RWS_Tarot_20_Judgement.jpg" },
    { rank: 21, filename: "RWS_Tarot_21_World.jpg" },
  ])(
    "resolves rank $rank to its local Rider-Waite image",
    ({ rank, filename }) => {
      const imagePath = RWSPath(rank);
      expect(imagePath).toBe(`/tarot/rws/${filename}`);
      const asset = statSync(new URL(`../public${imagePath}`, import.meta.url));
      expect(asset.isFile()).toBe(true);
      expect(asset.size).toBeGreaterThan(0);
    },
  );
});
