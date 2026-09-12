"use client";
import { Stack } from "@mui/material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import {
  useGongoIsPopulated,
  useGongoOne,
  useGongoSub,
} from "gongo-client-react";
import { useSession } from "next-auth/react";
import React, { use } from "react";
import db from "@/db";
import Link from "@/lib/link";
import {
  useRouter,
  useSearchParams,
  useSetSearchParam,
} from "@/lib/navigation";
import {
  fetchDueCards,
  newStudySetStats,
  randomCard,
  repetitionCards,
  reviewCard,
  type StudyAttempt,
} from "@/study/scheduling";
import getSet from "@/study/sets";
import type { StudySetStats } from "./exports";

const StudySetCol = db.collection("studySet");

function updateCardSet(
  cardId: string,
  _studyData: StudySetStats,
  attempt: StudyAttempt,
) {
  const { card, ...setUpdate } = reviewCard(cardId, _studyData, attempt);
  const studyDataUpdate: typeof setUpdate & { userId?: string } & Record<
      string,
      unknown
    > = {
    ...setUpdate,
    ["cards." + cardId]: card,
  };

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
    (db) => _id && db.collection("studySet").find({ setId: _id }),
  );
  useGongoSub("studySet");

  // console.log({ studyData });

  React.useEffect(() => {
    if (!_id) return;
    if (isPopulated && !studyData) {
      // Race conditiion, let's double check with sync
      // Note, previously the if had an errant semicolon (";") afterwards,
      // so was never checked before calling the next line.  Fixed now,
      // look out for any strange behaviour.  TODO.
      if (!StudySetCol.findOne({ setId: _id })) {
        console.log("Creating new study set stats");
        if (set) StudySetCol.insert(newStudySetStats(set, userId));
        else console.error("Failure.  Set not defined");
      }
    }
  }, [isPopulated, _id, set, studyData, userId]);

  if (!_id) return <div>No _id specified</div>;
  if (!isPopulated) return <div>Waiting for database population...</div>;
  if (!studyData) return <div>Waiting for study data...</div>;
  if (!allCards) return <div>Error: allCards not set</div>;
  if (!set) return <div>Error: set not defined</div>;

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
    cards = repetitionCards(allCards, studyData);
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
      // SuperMemo finishes on its final card; repetition can practice one card.
      if (mode === "repetition" || cards.length > 1)
        setTimeout(() => {
          setWrong(null);
          setCard(randomCard(cards, card));
          if (!wrong) setCorrect(correct + 1);
          setTotal(total + 1);
          setStartTime(Date.now());
        }, 200);
      updateCardSet(card.id, studyData, { wrongCount, startTime, mode });
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
          sx={{ justifyContent: "flex-end", textAlign: "right", width: "100%" }}
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
              <Grid
                key={i}
                size={{
                  xs: 12,
                  sm: 6,
                }}
              >
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
