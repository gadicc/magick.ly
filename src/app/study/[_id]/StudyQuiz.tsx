"use client";

import { Stack } from "@mui/material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import React from "react";
import enochianFont from "@/components/enochian/enochianFont";
import type { StudyMode } from "@/study/reviewContract";
import { randomCard } from "@/study/scheduling";
import type { StudyCard, StudySet, StudySetData } from "@/study/sets";

const questionFonts = {
  enochian: enochianFont.style,
} satisfies Record<
  NonNullable<StudySetData["questionFont"]>,
  React.CSSProperties
>;

export default function StudyQuiz({
  set,
  cards,
  mode,
  setMode,
  onReview,
  syncWarning,
}: {
  set: StudySet;
  cards: StudyCard[];
  mode: StudyMode;
  setMode: (mode: StudyMode) => void;
  onReview: (input: {
    cardId: string;
    mode: StudyMode;
    wrongCount: number;
    startTime: number;
  }) => Promise<void>;
  syncWarning: string | null;
}) {
  const [card, setCard] = React.useState(() => randomCard(cards));
  const [correct, setCorrect] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [wrong, setWrong] = React.useState<string | null>(null);
  const [wrongCount, setWrongCount] = React.useState(0);
  const [startTime, setStartTime] = React.useState(Date.now());
  const [answered, setAnswered] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const Question = set.Question;

  React.useEffect(() => {
    if (
      !answered &&
      !cards.some((candidate) => candidate.id === card.id) &&
      cards.length
    ) {
      setCard(randomCard(cards));
      setWrong(null);
      setWrongCount(0);
      setAnswered(false);
      setStartTime(Date.now());
    }
  }, [answered, card.id, cards]);

  async function clicked(answer: string) {
    if (answered) return;
    if (answer !== card.answer) {
      setWrong(answer);
      setWrongCount((value) => value + 1);
      return;
    }
    setWrong("noMatch");
    setAnswered(true);
    setSaveError(null);
    const completedWrongCount = wrongCount;
    try {
      await onReview({
        cardId: card.id,
        mode,
        wrongCount: completedWrongCount,
        startTime,
      });
    } catch {
      setSaveError("Progress could not be saved on this device. Try again.");
      setAnswered(false);
      return;
    }
    setTimeout(() => {
      const candidates =
        mode === "supermemo"
          ? cards.filter((candidate) => candidate.id !== card.id)
          : cards;
      if (candidates.length) setCard(randomCard(candidates, card));
      setWrong(null);
      setWrongCount(0);
      setAnswered(false);
      if (completedWrongCount === 0) setCorrect((value) => value + 1);
      setTotal((value) => value + 1);
      setStartTime(Date.now());
    }, 200);
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
              onChange={(event) => setMode(event.target.value as StudyMode)}
            >
              <option value="supermemo">supermemo</option>
              <option value="repetition">repetition</option>
            </select>
          </Box>
          <Box sx={{ my: 1 }}>
            {total === 0 ? "Go!" : `${correct} / ${total}`}
          </Box>
        </Stack>
        {(saveError || syncWarning) && (
          <Typography color={saveError ? "error" : "warning.main"}>
            {saveError ?? "Saved on this device; account sync will retry."}
          </Typography>
        )}
        <Question
          question={card.question}
          style={set.questionFont ? questionFonts[set.questionFont] : {}}
        />
        <Box sx={{ flexGrow: 1 }}>
          <Grid container spacing={1}>
            {card.answers.map((answer) => (
              <Grid key={answer} size={{ xs: 12, sm: 6 }}>
                <Button
                  fullWidth
                  disabled={answered && answer !== card.answer}
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
                  onClick={() => void clicked(answer)}
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
