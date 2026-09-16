"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import React from "react";
import { useSession } from "@/auth/client";
import {
  useRouter,
  useSearchParams,
  useSetSearchParam,
} from "@/lib/navigation";
import { useStudySet } from "@/study/client";
import type { StudyMode } from "@/study/reviewContract";
import { fetchDueCards, repetitionCards } from "@/study/scheduling";
import getSet from "@/study/sets";
import { useLegacyRecoveryGate } from "../../clientProviders";
import StudyQuiz from "./StudyQuiz";

export default function StudySetLoad({ _id }: { _id: string }) {
  const router = useRouter();
  const setSearchParam = useSetSearchParam();
  const searchParams = useSearchParams();
  const requestedMode = searchParams?.get("mode");
  const mode: StudyMode =
    requestedMode === "repetition" ? "repetition" : "supermemo";
  const session = useSession();
  const recovery = useLegacyRecoveryGate();
  const accountId =
    session.isPending || recovery.state !== "ready"
      ? undefined
      : (session.data?.user.id ?? null);
  const set = React.useMemo(() => {
    try {
      return getSet(_id);
    } catch {
      return null;
    }
  }, [_id]);
  const allCards = React.useMemo(() => set?.generateCards() ?? [], [set]);
  const cardIds = React.useMemo(
    () => (set ? Object.keys(set.data) : []),
    [set],
  );
  const runtime = useStudySet(accountId, _id, cardIds);
  const setMode = (next: StudyMode) => setSearchParam("mode", next);

  if (!set) return <div>Unknown study set.</div>;
  if (recovery.state === "failed")
    return (
      <div>
        Study progress is locked until old browser storage recovery succeeds.
      </div>
    );
  if (runtime.error && !runtime.snapshot)
    return <div>Study progress could not be loaded: {runtime.error}</div>;
  if (runtime.loading || !runtime.snapshot)
    return <div>Loading study progress…</div>;

  const cards =
    mode === "supermemo"
      ? fetchDueCards(allCards, runtime.snapshot)
      : repetitionCards(allCards, runtime.snapshot);
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
            onClick={() => setMode("repetition")}
          >
            Continue in Repetition Mode
          </Button>
        </Box>
      </Container>
    );
  }

  return (
    <StudyQuiz
      set={set}
      cards={cards}
      mode={mode}
      setMode={setMode}
      onReview={runtime.review}
      syncWarning={runtime.error}
    />
  );
}
