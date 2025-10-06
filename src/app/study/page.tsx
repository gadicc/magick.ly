"use client";

import {
  Button,
  Chip,
  Container,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { formatDistanceToNowStrict } from "date-fns";
import { WithId } from "gongo-client/lib/browser/Collection";
import {
  useGongoIsPopulated,
  useGongoLive,
  useGongoOne,
  useGongoSub,
  useGongoUserId,
} from "gongo-client-react";
import { signIn } from "next-auth/react";
import React from "react";
import db, { enableNetwork } from "@/db";
import Link from "@/lib/link";
import {
  useRouter,
  useSearchParams,
  useSetSearchParam,
} from "@/lib/navigation";
import { sets as allSets, tags as allTags } from "@/study/sets";
import { StudySetStats } from "./[_id]/exports";

function dueCount(set: WithId<StudySetStats>) {
  let count = 0;
  const now = new Date();

  for (const card of Object.values(set.cards)) if (card.dueDate <= now) count++;

  return count;
}

function StudyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSearchParam = useSetSearchParam();

  const _tags = searchParams?.get("tags");

  const tags = React.useMemo(
    () =>
      (_tags && (Array.isArray(_tags) ? _tags : _tags.split(","))) || ["all"],
    [_tags],
  );
  const isPopulated = useGongoIsPopulated();
  const gdGrade = searchParams?.get("gdGrade") || "all";

  const currentSets = useGongoLive((db) =>
    db.collection("studySet").find().sort("setId", "asc"),
  ).filter(
    (s) =>
      !!allSets[s.setId] &&
      (gdGrade === "all" || allSets[s.setId].gdGrade === gdGrade) &&
      (tags[0] === "all" ||
        tags.every((tag) => allSets[s.setId].tags?.includes(tag))),
  );

  const network = useGongoOne((db) => db.gongoStore.find({ _id: "network" }));
  const userId = useGongoUserId();
  useGongoSub("studySet");

  const setGdGrade = (event: SelectChangeEvent) =>
    setSearchParam("gdGrade", event.target.value);
  const setTags = (event: SelectChangeEvent) =>
    setSearchParam("tags", event.target.value);

  const currentSetIds = React.useMemo(
    () => currentSets.map((s) => s.setId),
    [currentSets],
  );

  const otherSets = React.useMemo(
    () =>
      Object.keys(allSets)
        .filter((key) => gdGrade === "all" || allSets[key].gdGrade === gdGrade)
        .filter(
          (key) =>
            !tags ||
            tags[0] === "all" ||
            tags.every((tag) => allSets[key].tags?.includes(tag)),
        )
        .filter((setId) => !currentSetIds.includes(setId))
        .map((setId) => allSets[setId])
        .sort((a, b) => {
          if (a.gdGrade !== b.gdGrade)
            return (
              parseInt(a.gdGrade.split("=")[0]) -
              parseInt(b.gdGrade.split("=")[0])
            );
          return a.id.localeCompare(b.id);
        }),
    [currentSetIds, gdGrade, tags],
  );

  const sortedTags = React.useMemo(() => [...allTags].sort(), []);

  React.useEffect(() => {
    // @ts-expect-error: TODO
    if (db.transport) db.transport.poll();
  }, []);

  if (!isPopulated) return <div>Initializating...</div>;

  return (
    <Container sx={{ py: 1 }}>
      <Select size="small" value={gdGrade} onChange={setGdGrade}>
        <MenuItem value="all">All Grades</MenuItem>
        <MenuItem value="0=0">0=0</MenuItem>
        <MenuItem value="1=10">1=10</MenuItem>
      </Select>{" "}
      <Select size="small" value={tags[0]} onChange={setTags}>
        <MenuItem value="all">All Tags</MenuItem>
        {sortedTags.map((tag) => (
          <MenuItem key={tag} value={tag}>
            {tag}
          </MenuItem>
        ))}
      </Select>
      <br />
      <br />
      <Typography variant="h5" sx={{ paddingBottom: 1 }}>
        Current Sets
      </Typography>
      <TableContainer component={Paper}>
        <Table aria-label="simple table">
          <TableHead>
            <TableRow>
              <TableCell>Set</TableCell>
              <TableCell align="center" width="100px">
                Due
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {currentSets.map((set) => {
              const dueCards = dueCount(set);
              const score =
                set.correct + set.incorrect > 0
                  ? Math.round(
                      (set.correct / (set.correct + set.incorrect)) * 100,
                    ) + "%"
                  : "(info)";

              return (
                <TableRow
                  key={set._id}
                  sx={{
                    opacity: dueCards ? 1 : 0.5,
                    "&:last-child td, &:last-child th": { border: 0 },
                  }}
                  // onClick={() => router.push("/study/" + set.setId)}
                >
                  <TableCell /* sx={{ verticalAlign: "top" }} */>
                    <div style={{ display: "inline-block", width: 55 }}>
                      <Chip size="small" label={allSets[set.setId].gdGrade} />
                    </div>
                    <Link href={"/study/" + set.setId}>{set.setId}</Link>
                  </TableCell>
                  <TableCell align="center" sx={{ _verticalAlign: "top" }}>
                    {dueCards
                      ? dueCards + " cards"
                      : "in " + formatDistanceToNowStrict(set.dueDate)}
                    <br />
                    <Link href={"/study/info/" + set.setId}>{score}</Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <br />
      {(!network?.enabled || !userId) && (
        <span>
          {!network?.enabled && (
            <>
              <Button onClick={enableNetwork}>Enable Network</Button>
              and{" "}
            </>
          )}
          <Button
            disabled={!network?.enabled}
            onClick={() => signIn() /*db.auth.loginWithService("google")*/}
          >
            Login
          </Button>
          to sync and save your progress, and participate in leaderboards
          (coming soon).
          <br />
          <br />
        </span>
      )}
      <Typography variant="h5" sx={{ paddingBottom: 1 }}>
        Available Sets
      </Typography>
      <TableContainer component={Paper}>
        <Table aria-label="simple table">
          <TableHead>
            <TableRow>
              <TableCell></TableCell>
              <TableCell>Set</TableCell>
              <TableCell align="right"># Cards</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {otherSets.map((set) => (
              <TableRow
                key={set.id}
                sx={{ "&:last-child td, &:last-child th": { border: 0 } }}
                onClick={() => router.push("/study/" + set.id)}
              >
                <TableCell sx={{ padding: "16px 0px 16px 10px" }}>
                  <Chip size="small" label={set.gdGrade} />
                </TableCell>
                <TableCell component="th" scope="row">
                  <Link href={"/study/" + set.id}>{set.id}</Link>
                </TableCell>
                <TableCell align="right">
                  {Object.keys(set.data).length}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <br />
      <Typography variant="h5">Requests</Typography>
      <Typography variant="body2">
        Happily taking requests for new sets, contact details on the{" "}
        <Link href="/about">About</Link> page. NB: I can only add data from
        public sources. Please don&apos;t send me any private Order documents.
        However, the heads of your order are welcome to make contact to have
        such data made available only to members of your order in a secure way.
      </Typography>
    </Container>
  );
}

export default function WrappedStudyPage() {
  return (
    <React.Suspense>
      <StudyPage />
    </React.Suspense>
  );
}
