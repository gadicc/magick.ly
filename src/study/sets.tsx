import Paper from "@mui/material/Paper";
import Tetragram from "@/app/geomancy/Tetragram";
import enochianFont from "@/components/enochian/enochianFont";
import data from "../../data/data";

// https://stackoverflow.com/a/56773391/1839099
function omit(key, obj) {
  const { [key]: _omitted, ...rest } = obj;
  return rest;
}

function SingleCharQuestion({
  question,
  style,
}: {
  question: string;
  style: Record<string, unknown>;
}) {
  return (
    <Paper
      sx={{
        my: 2,
        p: 2,
        fontSize: question.length < 7 ? "500%" : "150%",
        textAlign: "center",
        ...style,
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

export interface StudySetData<T = StudyCardDataItem> {
  // data
  id: string;
  data: Record<string, T>;
  question: string | ((item: T) => string | React.ReactNode);
  answer: string | ((item: T) => string);
  answers?: string[];
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
    | "10=1"
    | "?";
  tags?: string[];
}

export interface StudySet<T = StudyCardDataItem> extends StudySetData<T> {
  // methods
  Question: typeof SingleCharQuestion;
  generateCards: typeof generateCards;
  answer: (item: T) => string;
  answers: string[];
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
      (oItem, i) => oItem !== item && array.indexOf(oItem) === i,
    );
    shuffle(otherItems);
    const answers =
      _answers || otherItems.slice(0, 3).concat([item]).map(answer);
    if (!_answers) shuffle(answers);
    return {
      // setId: name,
      id: item.id,
      question: typeof question === "function" ? question(item) : question,
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
        `No such key "${key}" of path "${item}" in ${JSON.stringify(object)}`,
      );
    }
  }
  return object;
}

type UnwrapRecord<T> = T extends Record<string, infer U> ? U : T;

function filter<T>(
  data: T,
  func: ([id, item]: [string, UnwrapRecord<T>]) => boolean,
) {
  // @ts-expect-error: this broke on an upgrade, TODO anoter day
  return Object.fromEntries(Object.entries(data).filter(func));
}

const sets: Record<string, StudySetData<unknown>> = {
  "hebrew-latin": {
    id: "hebrew-latin",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "letter.latin",
    gdGrade: "0=0",
    tags: ["hebrew"],
  } as StudySetData<typeof data.hebrewLetter.aleph>,
  "hebrew-name": {
    id: "hebrew-name",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "letter.name",
    gdGrade: "0=0",
    tags: ["hebrew"],
  } as StudySetData<typeof data.hebrewLetter.aleph>,
  "hebrew-value": {
    id: "hebrew-value",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "value",
    gdGrade: "0=0",
    tags: ["hebrew"],
  } as StudySetData<typeof data.hebrewLetter.aleph>,
  "hebrew-meaning": {
    id: "hebrew-meaning",
    data: data.hebrewLetter,
    question: "letter.he",
    answer: "meaning.en",
    gdGrade: "0=0",
    tags: ["hebrew"],
  } as StudySetData<typeof data.hebrewLetter.aleph>,
  "planet-signs": {
    id: "planet-signs",
    data: filter(data.planet, ([id, planet]) => "symbol" in planet),
    question: "symbol",
    answer: "name.en.en",
    gdGrade: "0=0",
    tags: ["astrology"],
  } as StudySetData<typeof data.planet.earth>,
  "zodiac-signs": {
    id: "zodiac-signs",
    data: data.zodiac,
    question: "symbol",
    answer: "name.en",
    gdGrade: "0=0",
    tags: ["astrology"],
  } as StudySetData<typeof data.zodiac.aries>,
  "zodiac-triples": {
    id: "zodiac-triples",
    data: data.zodiac,
    question: "symbol",
    answer: "element.symbol",
    answers: ["🜁", "🜂", "🜄", "🜃"],
    gdGrade: "0=0",
    tags: ["astrology"],
  },
  "zodiac-quads": {
    id: "zodiac-quads",
    data: data.zodiac,
    question: "symbol",
    answer: "quadruplicity",
    answers: ["cardinal", "kerubic", "mutable"],
    gdGrade: "0=0",
    tags: ["astrology"],
  },
  // 1=10 zelator
  "alchemy-principals": {
    id: "alchemy-principals",
    data: filter(
      data.alchemySymbol,
      ([id, item]) => item.category === "principles",
    ),
    question: "altSymbol",
    answer: "name.en",
    gdGrade: "1=10",
    tags: ["alchemy"],
  } as StudySetData<typeof data.alchemySymbol>,
  "alchemy-planetary-metals": {
    id: "alchemy-planetary-metals",
    data: filter(
      data.alchemySymbol,
      ([id, item]) => item.category === "planets",
    ),
    question: "altSymbol",
    answer: "name.en",
    gdGrade: "1=10",
    tags: ["alchemy"],
  } as StudySetData<typeof data.alchemySymbol>,
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
    tags: ["geomancy"],
  } as StudySetData<typeof data.tetragram.via>,
  "geomancy-symbol-names": {
    id: "geomancy-symbol-names",
    data: data.tetragram,
    question: (item) => <Tetragram id={item.id} />,
    answer: "title.en",
    gdGrade: "1=10",
    tags: ["geomancy"],
  } as StudySetData<typeof data.tetragram.via>,
  "planets-hebrew-hebrew": {
    id: "planets-hebrew-hebrew",
    data: Object.fromEntries(
      // Only include cards that have a name.he (i.e. 7 traditional planets)
      Object.entries(data.planet).filter(([id, data]) => data?.name?.he),
    ),
    question: "name.en.en",
    answer: "name.he.he",
    gdGrade: "1=10",
    tags: ["astrology"],
  } as StudySetData<typeof data.planet.earth>,
  "planets-hebrew-romanized": {
    id: "planets-hebrew-romanized",
    data: Object.fromEntries(
      // Only include cards that have a name.he (i.e. 7 traditional planets)
      Object.entries(data.planet).filter(([id, data]) => data?.name?.he),
    ),
    question: "name.en.en",
    answer: "name.he.roman",
    gdGrade: "1=10",
    tags: ["astrology"],
  } as StudySetData<typeof data.planet.earth>,
  "planets-archangels-he": {
    id: "planets-archangels-he",
    data: Object.fromEntries(
      // Only include archangels that have a planet associated with them
      Object.entries(data.archangel).filter(([id, data]) => data?.planetId),
    ),
    question: "name.he",
    answer: "planet.name.he.he",
    gdGrade: "1=10",
    tags: ["astrology", "kabbalah"],
  } as StudySetData<typeof data.archangel.michael>,
  "sephirot-atziluth-divine-names-he": {
    id: "sephirot-atziluth-divine-names-he",
    data: data.sephirah,
    question: "name.he",
    answer: "godName.name.he",
    gdGrade: "1=10",
    tags: ["kabbalah"],
  } as StudySetData<typeof data.sephirah.keter>,
  "sephirot-atziluth-divine-names-he-roman": {
    id: "sephirot-atziluth-divine-names-he-roman",
    data: data.sephirah,
    question: "name.roman",
    answer: "godName.name.roman",
    gdGrade: "1=10",
    tags: ["kabbalah"],
  } as StudySetData<typeof data.sephirah.keter>,
  "alchemy-basic-terms": {
    id: "alchemy-basic-terms",
    question: "question",
    answer: "answer",
    gdGrade: "1=10",
    tags: ["alchemy"],
    data: (function () {
      const gradeTerms = Object.values(data.alchemyTerm).filter(
        (term) => term.gdGrade === 1,
      );

      // Create a new card for each term, i.e. for data items with
      // two terms, create two cards.
      const newData: [string, Omit<StudyCard, "answers">][] = [];
      for (const item of gradeTerms) {
        let i = 1;
        for (const term of item.terms.en) {
          const id = item.id + "-" + i++;
          newData.push([
            id,
            {
              id,
              question: item.name.en,
              answer: term,
            },
          ]);
        }
      }
      return Object.fromEntries(newData);
    })(),
  },
  "elementals-titles": {
    id: "elementals-titles",
    data: data.elemental,
    question: "namePlural.en",
    answer: "title.en",
    gdGrade: "1=10",
    tags: ["elemental"],
  } as StudySetData<typeof data.elemental.gnome>,
  "kerubim-face": {
    id: "kerubim-face",
    question: "question",
    answer: "answer",
    gdGrade: "1=10",
    tags: ["kabbalah"],
    data: Object.fromEntries(
      Object.entries(data.kerub).map(([id, kerub]) => [
        id,
        {
          id,
          question: kerub.title.en,
          answer: kerub.face.roman + " | " + kerub.face.he,
        },
      ]),
    ),
  } as StudySetData<Partial<typeof data.kerub.air>>,
  "kerubim-zodiac": {
    id: "kerubim-zodiac",
    question: "question",
    answer: "answer",
    gdGrade: "1=10",
    tags: ["kabbalah"],
    data: Object.fromEntries(
      Object.entries(data.kerub).map(([id, kerub]) => [
        id,
        {
          id,
          question: kerub.title.en,
          answer: kerub.zodiac?.symbol + " " + kerub.zodiac?.name.en,
        },
      ]),
    ),
  } as StudySetData<Partial<typeof data.kerub.air>>,
  "four-worlds-desc": {
    id: "four-worlds-desc",
    data: data.fourWorlds,
    question: "name.roman",
    answer: "desc.en",
    gdGrade: "1=10",
    tags: ["kabbalah"],
  } as StudySetData<typeof data.fourWorlds.atzilut>,
  "four-worlds-residents": {
    id: "four-worlds-residents",
    data: data.fourWorlds,
    question: "name.roman",
    answer: "residentsTitle.en",
    gdGrade: "1=10",
    tags: ["kabbalah"],
  } as StudySetData<typeof data.fourWorlds.atzilut>,
  "ten-heavens": {
    id: "ten-heavens",
    data: omit("daat", data.sephirah),
    question: (sephirah) => sephirah.index + ". " + sephirah.name.roman,
    answer: (sephirah) => {
      if (sephirah?.tenHeavens?.en)
        return sephirah.tenHeavens.en + " / " + sephirah.tenHeavens.roman;
      const planet = sephirah?.planet;
      return "Sphere of " + planet?.name.en.en + " / " + planet?.name.he.roman;
    },
    gdGrade: "1=10",
    tags: ["kabbalah"],
  } as StudySetData<typeof data.sephirah.keter>,
  "sephirot-stones": {
    id: "sephirot-stones",
    data: omit("daat", data.sephirah),
    question: "name.roman",
    answer: "stone",
    gdGrade: "1=10",
    tags: ["kabbalah"],
  } as StudySetData<typeof data.sephirah>,
  "enochian-letters-latin": {
    id: "enochian-letters-latin",
    data: data.enochianLetter,
    question: "enochian",
    questionStyle: enochianFont.style,
    answer: "english",
    tags: ["enochian"],
    gdGrade: "?",
  } as StudySetData<typeof data.enochianLetter.A>,
  "enochian-letter-names": {
    id: "enochian-letter-names",
    data: data.enochianLetter,
    question: "enochian",
    questionStyle: enochianFont.style,
    answer: "title",
    tags: ["enochian"],
    gdGrade: "?",
  } as StudySetData<typeof data.enochianLetter.A>,
};

function getSet(id: string) {
  if (!sets[id]) throw new Error("No such set");

  // @ts-expect-error: TODO
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

const tags = Array.from(
  new Set(
    Object.values(sets)
      .flatMap((set) => set.tags)
      .filter(Boolean),
  ),
);

// console.log({ sets, tags });
export { sets, tags };
export default getSet;
