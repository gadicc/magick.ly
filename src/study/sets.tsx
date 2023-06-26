import React from "react";
import Paper from "@mui/material/Paper";

import data from "../../data/data";
import Tetragram from "../../components/geomancy/Tetragram";
import { AlchemyTerms } from "../../data/alchemy/Terms";

function SingleCharQuestion({ question }: { question: string }) {
  return (
    <Paper
      sx={{
        my: 2,
        p: 2,
        fontSize: question.length < 7 ? "500%" : "150%",
        textAlign: "center",
      }}
    >
      {question}
    </Paper>
  );
}

// TODO, rather just pull out X shuffled items.
// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
function shuffle<T>(array: T[]) {
  let currentIndex = array.length,
    randomIndex;
  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

export interface StudyCardDataItem {
  id: string;
  [key: string]: unknown;
}

export interface StudySet {
  // methods
  Question: typeof SingleCharQuestion;
  generateCards: typeof generateCards;
  // data
  id: string;
  data: StudyCardDataItem[];
  question: (item: unknown) => string;
  answer: (item: unknown) => string;
  answers: string[];
  gdGrade:
    | "0=0"
    | "1=10"
    | "2=9"
    | "3=8"
    | "4=7"
    | "5=6"
    | "6=5"
    | "7=4"
    | "8=3"
    | "9=2"
    | "10=1";
}

export interface StudyCard {
  id: string;
  question: string;
  answer: string;
  answers: string[];
}

function generateCards(this: StudySet) {
  const { data, question, answer, answers: _answers } = this;
  const array = Object.values(data);

  shuffle(array);
  return array.map((item) => {
    const otherItems = array.filter(
      (oItem, i) => oItem !== item && array.indexOf(oItem) === i
    );
    shuffle(otherItems);
    const answers =
      _answers || otherItems.slice(0, 3).concat([item]).map(answer);
    if (!_answers) shuffle(answers);
    return {
      // setId: name,
      id: item.id,
      question: question(item),
      answer: answer(item),
      answers,
    } as StudyCard;
  });
}

const setDefaults = {
  Question: SingleCharQuestion,
  generateCards,
};

function dotProps(item, object) {
  const keys = item.split(".");
  for (const key of keys) {
    if (object[key]) object = object[key];
    else {
      console.error(object);
      throw new Error(
        `No such key "${key}" of path "${item}" in ${JSON.stringify(object)}`
      );
    }
  }
  return object;
}

type UnwrapRecord<T> = T extends Record<string, infer U> ? U : T;

function filter<T>(
  data: T,
  func: ([id, item]: [string, UnwrapRecord<T>]) => boolean
) {
  // @ts-expect-error: this broke on an upgrade, TODO anoter day
  return Object.fromEntries(Object.entries(data).filter(func));
}

const sets = {
  "hebrew-latin": {
    id: "hebrew-latin",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "letter.latin",
    gdGrade: "0=0",
  },
  "hebrew-name": {
    id: "hebrew-name",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "letter.name",
    gdGrade: "0=0",
  },
  "hebrew-value": {
    id: "hebrew-value",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "value",
    gdGrade: "0=0",
  },
  "hebrew-meaning": {
    id: "hebrew-meaning",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "meaning.en",
    gdGrade: "0=0",
  },
  "planet-signs": {
    id: "planet-signs",
    data: data.planet,
    question: "symbol",
    answer: "name.en.en",
    gdGrade: "0=0",
  },
  "zodiac-signs": {
    id: "zodiac-signs",
    data: data.zodiac,
    question: "symbol",
    answer: "name.en",
    gdGrade: "0=0",
  },
  "zodiac-triples": {
    id: "zodiac-triples",
    data: data.zodiac,
    question: "symbol",
    answer: "element.symbol",
    answers: ["🜁", "🜂", "🜄", "🜃"],
    gdGrade: "0=0",
  },
  "zodiac-quads": {
    id: "zodiac-quads",
    data: data.zodiac,
    question: "symbol",
    answer: "quadruplicity",
    answers: ["cardinal", "kerubic", "mutable"],
    gdGrade: "0=0",
  },
  // 1=10 zelator
  "alchemy-principals": {
    id: "alchemy-principals",
    data: filter(
      data.alchemySymbol,
      ([id, item]) => item.category === "principles"
    ),
    question: "altSymbol",
    answer: "name.en",
    gdGrade: "1=10",
  },
  "alchemy-planetary-metals": {
    id: "alchemy-planetary-metals",
    data: filter(
      data.alchemySymbol,
      ([id, item]) => item.category === "planets"
    ),
    question: "altSymbol",
    answer: "name.en",
    gdGrade: "1=10",
  },
  // REMOVED - split into alchemy-{principals,planetary-metals}
  // "zelator-alchemy-symbols": {
  //   id: "zelator-alchemy-symbols",
  //   data: data.alchemySymbol,
  //   question: "altSymbol",
  //   answer: "name.en",
  //   gdGrade: "1=10",
  // },
  "geomancy-names-translation": {
    id: "geomancy-names-translation",
    data: data.tetragram,
    question: "title.en",
    answer: "translation.en",
    gdGrade: "1=10",
  },
  "geomancy-symbol-names": {
    id: "geomancy-symbol-names",
    data: data.tetragram,
    question: (item) => <Tetragram id={item.id} />,
    answer: "title.en",
    gdGrade: "1=10",
  },
  "planets-hebrew-hebrew": {
    id: "planets-hebrew-hebrew",
    data: Object.fromEntries(
      // Only include cards that have a name.he (i.e. 7 traditional planets)
      Object.entries(data.planet).filter(([id, data]) => data?.name?.he)
    ),
    question: "name.en.en",
    answer: "name.he.he",
    gdGrade: "1=10",
  },
  "planets-hebrew-romanized": {
    id: "planets-hebrew-romanized",
    data: Object.fromEntries(
      // Only include cards that have a name.he (i.e. 7 traditional planets)
      Object.entries(data.planet).filter(([id, data]) => data?.name?.he)
    ),
    question: "name.en.en",
    answer: "name.he.roman",
    gdGrade: "1=10",
  },
  "planets-archangels-he": {
    id: "planets-archangels-he",
    data: Object.fromEntries(
      // Only include archangels that have a planet associated with them
      Object.entries(data.archangel).filter(([id, data]) => data?.planetId)
    ),
    question: "name.he",
    answer: "planet.name.he.he",
    gdGrade: "1=10",
  },
  "sephirot-atziluth-divine-names-he": {
    id: "sephirot-atziluth-divine-names-he",
    data: data.sephirah,
    question: "name.he",
    answer: "godName.name.he",
    gdGrade: "1=10",
  },
  "sephirot-atziluth-divine-names-he-roman": {
    id: "sephirot-atziluth-divine-names-he-roman",
    data: data.sephirah,
    question: "name.romanization",
    answer: "godName.name.romanization",
    gdGrade: "1=10",
  },
  "zelator-alchemy-terms": {
    id: "zelator-alchemy-terms",
    data: (function () {
      const gradeTerms = Object.values(data.alchemyTerm).filter(
        (term) => term.gdGrade === 1
      );

      // Create a new card for each term, i.e. for data items with
      // two terms, create two cards.
      const terms: any = [];
      for (const item of gradeTerms) {
        let i = 1;
        for (const term of item.terms.en)
          terms.push({
            id: item.id + "-" + i++,
            name: item.name,
            term: { en: term },
          });
      }
      console.log(terms);
      return terms;
    })(),
    question: "name.en",
    answer: "term.en",
    gdGrade: "1=10",
  },
  "elementals-titles": {
    id: "elementals-titles",
    data: data.elemental,
    question: "namePlural.en",
    answer: "title.en",
    gdGrade: "1=10",
  },
};

function getSet(id: string) {
  if (!sets[id]) throw new Error("No such set");

  const set: StudySet = {
    ...setDefaults,
    ...sets[id],
  };

  set.generateCards.bind(set);

  // Allow e.g. "name.en" to create (item) => item.name.en;
  for (const key of ["question", "answer"]) {
    if (typeof set[key] === "string")
      set[key] = dotProps.bind(undefined, set[key]);
  }

  return set;
}

export { sets };
export default getSet;
