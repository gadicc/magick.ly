import React from "react";
import {
  useGongoLive,
  useGongoOne,
  useGongoUserId,
  useGongoIsPopulated,
  useGongoSub,
} from "gongo-client-react";
import { WithId } from "gongo-client/lib/browser/Collection";
import { useRouter } from "next/router";
import { formatDistanceToNowStrict } from "date-fns";
import { signIn } from "next-auth/react";

import {
  Container,
  Button,
  Chip,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  Select,
  MenuItem,
  SelectChangeEvent,
} from "@mui/material";

import Link from "../../src/Link";
import AppBar from "../../components/AppBar";
import { sets as allSets, tags as allTags } from "../../src/study/sets";
import db, { enableNetwork } from "../../src/db";
import { StudySetStats } from "./[_id]";

function dueCount(set: WithId<StudySetStats>) {
  let count = 0;
  const now = new Date();

  for (const card of Object.values(set.cards)) if (card.dueDate <= now) count++;

  return count;
}

export default function Study() {
  const router = useRouter();
  const tags = React.useMemo(
    () =>
      (router.query.tags &&
        (Array.isArray(router.query.tags)
          ? router.query.tags
          : router.query.tags.split(","))) || ["all"],
    [router.query.tags]
  );
  const isPopulated = useGongoIsPopulated();
  const gdGrade = router.query.gdGrade || "all";
  const currentSets = useGongoLive((db) =>
    db.collection("studySet").find()
  ).filter(
    (s) =>
      !!allSets[s.setId] &&
      (gdGrade === "all" || allSets[s.setId].gdGrade === gdGrade) &&
      (tags[0] === "all" ||
        tags.every((tag) => allSets[s.setId].tags?.includes(tag)))
  );
  const network = useGongoOne((db) => db.gongoStore.find({ _id: "network" }));
  const userId = useGongoUserId();
  useGongoSub("studySet");

  const setGdGrade = (event: SelectChangeEvent) =>
    router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        gdGrade: event.target.value,
      },
    });
  const setTags = (event: SelectChangeEvent) =>
    router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        tags: [event.target.value],
      },
    });

  const currentSetIds = React.useMemo(
    () => currentSets.map((s) => s.setId),
    [currentSets]
  );

  const otherSets = React.useMemo(
    () =>
      Object.keys(allSets)
        .filter((key) => gdGrade === "all" || allSets[key].gdGrade === gdGrade)
        .filter(
          (key) =>
            !tags || tags.every((tag) => allSets[key].tags?.includes(tag))
        )
        .filter((setId) => !currentSetIds.includes(setId))
        .map((setId) => allSets[setId]),
    [currentSetIds, gdGrade, tags]
  );

  const sortedTags = React.useMemo(() => [...allTags].sort(), []);

  React.useEffect(() => {
    // @ts-expect-error: TODO
    if (db.transport) db.transport.poll();
  }, []);

  if (!isPopulated) return <div>Initializating...</div>;

  return (
    <>
      <AppBar title="Study" />

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
                <TableCell></TableCell>
                <TableCell>Set</TableCell>
                <TableCell align="right">Grade</TableCell>
                <TableCell align="right">Due</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentSets.map((set) => (
                <React.Fragment key={set._id}>
                  <TableRow
                    key={set._id}
                    sx={{ "&:last-child td, &:last-child th": { border: 0 } }}
                    // onClick={() => router.push("/study/" + set.setId)}
                  >
                    <TableCell sx={{ padding: "16px 0px 16px 10px" }}>
                      <Chip size="small" label={allSets[set.setId].gdGrade} />
                    </TableCell>
                    <TableCell component="th" scope="row">
                      <Link href={"/study/" + set.setId}>{set.setId}</Link>{" "}
                    </TableCell>
                    <TableCell rowSpan={2} align="right">
                      {set.correct + set.incorrect > 0
                        ? Math.round(
                            (set.correct / (set.correct + set.incorrect)) * 100
                          ) + "%"
                        : "-"}
                    </TableCell>
                    <TableCell align="right">
                      {(function () {
                        const dueCards = dueCount(set);
                        return dueCards
                          ? dueCards + " cards"
                          : "in " + formatDistanceToNowStrict(set.dueDate);
                      })()}
                    </TableCell>
                    <TableCell sx={{ padding: "16px 10px 16px 0px" }}>
                      <Link href={"/study/info/" + set.setId}>
                        <div
                          style={{
                            border: "1px solid black",
                            borderRadius: "50%",
                            padding: "5px 10px 5px 10px",
                            background: "#ddd",
                            fontWeight: "bold",
                          }}
                        >
                          i
                        </div>
                      </Link>
                    </TableCell>
                  </TableRow>
                  <TableRow></TableRow>
                </React.Fragment>
              ))}
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
          such data made available only to members of your order in a secure
          way.
        </Typography>
      </Container>
    </>
  );
}
