"use client";
import React, { use } from "react";
import { supermemo } from "supermemo";
import {
  useGongoOne,
  useGongoIsPopulated,
  useGongoSub,
} from "gongo-client-react";

import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

import Link from "@/lib/link";

import getSet, { StudyCard, type StudySet } from "@/study/sets";
import db from "@/db";
import { Stack } from "@mui/material";
import { StudyCardStats, StudySetStats } from "./exports";
import {
  useSearchParams,
  useSetSearchParam,
  useRouter,
} from "@/lib/navigation";
import { useSession } from "next-auth/react";

/*
export async function getServerSideProps(context) {
  const { _id } = context.query;
  return { props: { _id } };
}
*/

function newCardStats(): StudyCardStats {
  return {
    correct: 0,
    incorrect: 0,
    time: 0,
    dueDate: new Date(),
    supermemo: {
      interval: 0,
      repetition: 0,
      efactor: 2.5,
    },
    repetition: {
      weight: 1,
    },
  };
}

function randomCard(
  set: StudyCard[],
  prevCard: StudyCard | null = null
): StudyCard {
  const newCard = set[Math.floor(Math.random() * set.length)];
  return newCard === prevCard ? randomCard(set, prevCard) : newCard;
}

const StudySetCol = db.collection("studySet");

function newStudySetStats(set: StudySet, userId: string) {
  const studySetStats: StudySetStats = {
    setId: set.id,
    cards: {},
    correct: 0,
    incorrect: 0,
    time: 0,
    dueDate: new Date(),
  };

  if (userId) {
    studySetStats.userId = userId;
    studySetStats.__ObjectIDs = ["userId"];
  }

  for (const cardId of Object.keys(set.data)) {
    studySetStats.cards[cardId] = newCardStats();
  }

  // console.log({ studySetStats });
  return studySetStats;
}

function updateCardSet(
  set,
  cardId,
  _studyData: StudySetStats,
  { wrongCount, startTime, mode }
) {
  const card = { ..._studyData.cards[cardId] };

  interface StudyDataUpdate {
    correct: number;
    incorrect: number;
    time: number;
    dueDate?: Date;
    userId?: string;
    [key: string]: unknown; // e.g. $set: { ["cards.card_id"]: card }
  }

  const studyDataUpdate: StudyDataUpdate = {
    correct: _studyData.correct,
    incorrect: _studyData.incorrect,
    time: _studyData.time,
    ["cards." + cardId]: card,
  };

  // console.log({ cardSet, card });

  const elapsed = Date.now() - startTime;
  card.time += elapsed;
  studyDataUpdate.time += elapsed;

  let grade;
  if (wrongCount === 0) {
    card.correct++;
    studyDataUpdate.correct++;
    if (elapsed < 3000) grade = 5;
    else if (elapsed < 5000) grade = 4;
    else grade = 3;
  } else {
    card.incorrect++;
    studyDataUpdate.incorrect++;
    if (elapsed < 3000) grade = 2;
    else if (elapsed < 8000) grade = 1;
    else grade = 0;
  }

  // console.log({ wrongCount, startTime, elapsed, grade });

  if (mode === "supermemo") {
    console.log(card);
    card.supermemo = supermemo(card.supermemo, grade);

    const dayInMs = 86400000;
    //const oldDueDate = card.dueDate.getTime();
    card.dueDate = new Date(Date.now() + card.supermemo.interval * dayInMs);

    let earliestDueDate = card.dueDate;
    for (const [id, card2] of Object.entries(_studyData.cards)) {
      // Skip currentId because we already used it but more importantly, we
      // didn't mutate _studyData.cards[currentId] so it would be the previous
      // dueDate, i.e. before now & thus guaranteed (but incorrect) "earliest"
      if (id !== cardId && card2.dueDate < earliestDueDate)
        earliestDueDate = card2.dueDate;
    }
    studyDataUpdate.dueDate = earliestDueDate;
  } else if (mode === "repetition") {
    card.repetition = {
      // 6 so if they get it correct (5) it will still repeat (once, unweighted)
      weight: 6 - grade,
    };
  }

  //if (studyData.dueDate.getTime() === oldDueDate) studyData.dueDate = card.dueDate;

  // If we weren't logged in before, but are now, take this opportunity to
  // populate userId.  TODO: probably a better place to do this.
  if ("auth" in db && typeof db.auth === "object" && "getUserId" in db.auth) {
    // XXX TODO Does this still work after switching primarily to next-auth???
    const userId = db.auth.getUserId();
    if (userId && !_studyData.userId) {
      studyDataUpdate.userId = userId;
      if (!_studyData.__ObjectIDs) _studyData.__ObjectIDs = [];
      _studyData.__ObjectIDs.push("userId");
    }
  }

  // Gongo quirk: since we're updating with the same data*, it will skip.
  // *i.e., we mutate the original record, then ask to update it, but there's
  // "no change".
  console.log({ $set: studyDataUpdate });
  if (_studyData._id)
    StudySetCol.update(_studyData._id, {
      $set: studyDataUpdate,
    });
}

function fetchDueCards(
  allCards: StudyCard[],
  studyData: StudySetStats
): StudyCard[] {
  const now = new Date();
  const cards: StudyCard[] = [];
  for (const setCard of allCards) {
    const studySetCard = studyData.cards[setCard.id] || newCardStats();
    if (studySetCard.dueDate <= now) cards.push(setCard);
  }
  return cards;
}

export default function StudySetLoad(props: {
  params: Promise<{ _id: string }>;
}) {
  const params = use(props.params);

  const { _id } = params;

  const router = useRouter();
  const setSearchParam = useSetSearchParam();
  const searchParams = useSearchParams();
  const mode = searchParams?.get("mode") || "supermemo";
  const session = useSession();
  const userId = session.data?.user?.id;

  const setMode = (mode) => setSearchParam("mode", mode);

  const isPopulated = useGongoIsPopulated();
  const set = React.useMemo(() => _id && getSet(_id), [_id]);
  const allCards = React.useMemo(() => set && set.generateCards(), [set]);
  const studyData = useGongoOne(
    (db) => _id && db.collection("studySet").find({ setId: _id })
  );
  useGongoSub("studySet");

  // console.log({ studyData });

  const studyDataExists = !!studyData;
  React.useEffect(() => {
    if (!_id) return;
    if (isPopulated && !studyData && userId) {
      // Race conditiion, let's double check with sync
      // Note, previously the if had an errant semicolon (";") afterwards,
      // so was never checked before calling the next line.  Fixed now,
      // look out for any strange behaviour.  TODO.
      if (!StudySetCol.findOne({ setId: _id }))
        if (set) StudySetCol.insert(newStudySetStats(set, userId));
    }
  }, [studyDataExists, isPopulated, _id, set, studyData, userId]);

  if (!_id || !studyData || !isPopulated) return <div>Initializing</div>;

  if (!allCards) throw new Error("allCards not set");
  if (!set) throw new Error("set not defined");

  let cards;
  if (mode === "supermemo") {
    cards = fetchDueCards(allCards, studyData);
    console.log({ set, allCards, cards, studyData });

    if (cards.length === 0) {
      return (
        <Container maxWidth="lg" sx={{ p: 0 }}>
          <Box sx={{ p: 2, textAlign: "center" }}>
            <div style={{ fontSize: "500%" }}>🏆</div>
            <Typography variant="body1">
              You&apos;re all done for the day!
            </Typography>
            <br />
            <Button variant="contained" onClick={() => router.back()}>
              Back to Study Home
            </Button>
            <br />
            <Button
              sx={{ my: 1 }}
              variant="outlined"
              component={Link}
              href={location.href + "?mode=repetition"}
            >
              Continue in Repetition Mode
            </Button>
          </Box>
        </Container>
      );
    }
  } else {
    cards = [];
    for (const setCard of allCards) {
      const studySetCard = studyData.cards[setCard.id] || newCardStats();
      const weight = studySetCard?.repetition?.weight || 1;
      for (let i = 0; i < weight; i++) cards.push(setCard);
    }
  }

  return (
    <StudySet
      set={set}
      cards={cards}
      studyData={studyData}
      mode={mode}
      setMode={setMode}
    />
  );
}

function StudySet({ set, cards, studyData, mode, setMode }) {
  console.log({ cards });
  const [card, setCard] = React.useState(randomCard(cards));
  const [correct, setCorrect] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [wrong, setWrong] = React.useState<string | null>(null);
  const [wrongCount, setWrongCount] = React.useState(0);
  const [startTime, setStartTime] = React.useState(Date.now());
  const Question = set.Question;
  // console.log({ set, cards, card });

  function clicked(answer) {
    if (answer === card.answer) {
      setWrong("noMatch"); // to show answer in green
      setWrongCount(0);
      // If we're on the final card, don't try set a new card at the end.
      if (cards.length > 1)
        setTimeout(() => {
          setWrong(null);
          setCard(randomCard(cards, card));
          if (!wrong) setCorrect(correct + 1);
          setTotal(total + 1);
          setStartTime(Date.now());
        }, 200);
      updateCardSet(set, card.id, studyData, { wrongCount, startTime, mode });
    } else {
      setWrong(answer);
      setWrongCount(wrongCount + 1);
    }
  }

  return (
    <Container maxWidth="lg" sx={{ p: 0 }}>
      <Box sx={{ p: 2 }}>
        <Stack
          direction="row"
          justifyContent="flex-end"
          sx={{ textAlign: "right", width: "100%" }}
        >
          <Box sx={{ my: 1, mr: 2 }}>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="supermemo">supermemo</option>
              <option value="repetition">repetition</option>
            </select>
          </Box>
          <Box sx={{ my: 1 }}>
            {total === 0 ? "Go!" : `${correct} / ${total}`}
          </Box>
        </Stack>

        <Question question={card.question} style={set.questionStyle} />
        <Box sx={{ flexGrow: 1 }}>
          <Grid container spacing={1}>
            {card.answers.map((answer, i) => (
              <Grid key={i} item xs={12} sm={6}>
                <Button
                  fullWidth
                  variant="outlined"
                  style={{
                    color: wrong && answer === card.answer ? "white" : "",
                    background: wrong
                      ? answer === wrong
                        ? "red"
                        : answer === card.answer
                        ? "green"
                        : "transparent"
                      : "transparent",
                  }}
                  onClick={clicked.bind(this, answer)}
                >
                  {answer}
                </Button>
              </Grid>
            ))}
          </Grid>
        </Box>
      </Box>
    </Container>
  );
}

// export default dynamic(Promise.resolve(StudySetLoad), { ssr: false });
