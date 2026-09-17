import { describe, expect, it, vi } from "vitest";
import getSet, { sets } from "./sets";

// The study API route loads these sets, and Turbopack gives route handlers no
// `next/font`; a font import here would break that route.
vi.mock("next/font/local", () => {
  throw new Error("study sets must not load next/font");
});

describe("study sets", () => {
  it("resolve card ids without loading fonts", () => {
    for (const id of Object.keys(sets))
      expect(Object.keys(getSet(id).data).length, id).toBeGreaterThan(0);
    expect(() => getSet("missing")).toThrow("No such set");
  });

  it("name the Enochian question font", () => {
    expect(sets["enochian-letters-latin"].questionFont).toBe("enochian");
    expect(sets["enochian-letter-names"].questionFont).toBe("enochian");
  });

  it("never offer the same answer twice", () => {
    // Final letters share their letter's meaning, as in hebrewLetters.json5.
    const letters = (meanings: Record<string, string>) => ({
      ...getSet("hebrew-meaning"),
      data: Object.fromEntries(
        Object.entries(meanings).map(([id, en]) => [
          id,
          { id, letter: { he: id }, meaning: { en } },
        ]),
      ),
    });
    const offered = (set: ReturnType<typeof letters>) =>
      Object.fromEntries(
        set.generateCards().map((card) => [card.id, card.answers.toSorted()]),
      );

    // Five letters but three meanings: three other letters always repeat a
    // meaning, among the distractors or the card's own.
    const three = ["fish", "ox", "palm of hand"];
    expect(
      offered(
        letters({
          aleph: "ox",
          kaf: "palm of hand",
          "kaf-sofit": "palm of hand",
          nun: "fish",
          "nun-sofit": "fish",
        }),
      ),
    ).toEqual({
      aleph: three,
      kaf: three,
      "kaf-sofit": three,
      nun: three,
      "nun-sofit": three,
    });

    // With five meanings for four places, every card still gets three
    // different distractors.
    const cards = letters({
      aleph: "ox",
      beth: "house",
      gimel: "camel",
      kaf: "palm of hand",
      "kaf-sofit": "palm of hand",
      nun: "fish",
      "nun-sofit": "fish",
    }).generateCards();
    expect(cards).toHaveLength(7);
    for (const card of cards) {
      expect(new Set(card.answers).size, card.id).toBe(4);
      expect(card.answers, card.id).toContain(card.answer);
    }
  });

  it("offer each card's answer once in every set", () => {
    for (const id of Object.keys(sets))
      for (const card of getSet(id).generateCards()) {
        const label = `${id}/${card.id}`;
        expect(new Set(card.answers).size, label).toBe(card.answers.length);
        expect(card.answers, label).toContain(card.answer);
      }
  });
});
