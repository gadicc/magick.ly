"use client";

import {
  Chip,
  Container,
  MenuItem,
  Paper,
  Select,
  type SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { formatDistanceToNowStrict } from "date-fns";
import React from "react";
import { useSession } from "@/auth/client";
import Link from "@/lib/link";
import {
  useRouter,
  useSearchParams,
  useSetSearchParam,
} from "@/lib/navigation";
import { useStudyList } from "@/study/client";
import { materializeStudyCards } from "@/study/reviewContract";
import { dueCount } from "@/study/scheduling";
import { sets as allSets, tags as allTags } from "@/study/sets";
import { useLegacyRecoveryGate } from "../clientProviders";

function StudyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSearchParam = useSetSearchParam();
  const session = useSession();
  const recovery = useLegacyRecoveryGate();
  const accountId =
    session.isPending || recovery.state !== "ready"
      ? undefined
      : (session.data?.user.id ?? null);
  const runtime = useStudyList(accountId);
  const selectedTags = searchParams?.get("tags");
  const tags = React.useMemo(
    () => selectedTags?.split(",") ?? ["all"],
    [selectedTags],
  );
  const gdGrade = searchParams?.get("gdGrade") || "all";
  const setGdGrade = (event: SelectChangeEvent) =>
    setSearchParam("gdGrade", event.target.value);
  const setTags = (event: SelectChangeEvent) =>
    setSearchParam("tags", event.target.value);

  const currentSets = React.useMemo(
    () =>
      runtime.snapshots
        .filter(
          (row) =>
            !!allSets[row.setId] &&
            (gdGrade === "all" || allSets[row.setId].gdGrade === gdGrade) &&
            (tags[0] === "all" ||
              tags.every((tag) => allSets[row.setId].tags?.includes(tag))),
        )
        .map((row) =>
          materializeStudyCards(
            row,
            Object.keys(allSets[row.setId].data),
            Date.now(),
          ),
        ),
    [gdGrade, runtime.snapshots, tags],
  );
  const currentSetIds = React.useMemo(
    () => new Set(currentSets.map((row) => row.setId)),
    [currentSets],
  );
  const otherSets = React.useMemo(
    () =>
      Object.values(allSets)
        .filter((set) => gdGrade === "all" || set.gdGrade === gdGrade)
        .filter(
          (set) =>
            tags[0] === "all" || tags.every((tag) => set.tags?.includes(tag)),
        )
        .filter((set) => !currentSetIds.has(set.id))
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

  if (recovery.state === "failed")
    return (
      <div>
        Study progress is locked until old browser storage recovery succeeds.
      </div>
    );
  if (runtime.error && !runtime.scope)
    return <div>Study progress could not be loaded: {runtime.error}</div>;
  if (runtime.loading) return <div>Initializing study progress…</div>;

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
      {runtime.error && (
        <Typography color="warning.main" sx={{ mt: 1 }}>
          Progress is saved on this device. Sync will retry when available.
        </Typography>
      )}
      <br />
      <br />
      <Typography variant="h5" sx={{ paddingBottom: 1 }}>
        Current Sets
      </Typography>
      <TableContainer component={Paper}>
        <Table aria-label="Current study sets">
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
              const attempts = set.correct + set.incorrect;
              const score = attempts
                ? `${Math.round((set.correct / attempts) * 100)}%`
                : "(info)";
              return (
                <TableRow
                  key={set.setId}
                  sx={{
                    opacity: dueCards ? 1 : 0.5,
                    "&:last-child td, &:last-child th": { border: 0 },
                  }}
                >
                  <TableCell>
                    <div style={{ display: "inline-block", width: 55 }}>
                      <Chip size="small" label={allSets[set.setId].gdGrade} />
                    </div>
                    <Link href={`/study/${set.setId}`}>{set.setId}</Link>
                  </TableCell>
                  <TableCell align="center">
                    {dueCards
                      ? `${dueCards} cards`
                      : `in ${formatDistanceToNowStrict(set.dueDate)}`}
                    <br />
                    <Link href={`/study/info/${set.setId}`}>{score}</Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <br />
      {runtime.scope?.kind === "anonymous" ? (
        <Typography variant="body2" sx={{ mb: 2 }}>
          Anonymous progress is available offline on this device.{" "}
          <Link href="/signin?callbackURL=/study">Sign in</Link> to keep
          separate account progress in sync.
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ mb: 2 }}>
          Account progress syncs when online. Existing anonymous device progress
          remains separate and is available after sign-out.
        </Typography>
      )}
      <Typography variant="h5" sx={{ paddingBottom: 1 }}>
        Available Sets
      </Typography>
      <TableContainer component={Paper}>
        <Table aria-label="Available study sets">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Set</TableCell>
              <TableCell align="right"># Cards</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {otherSets.map((set) => (
              <TableRow
                key={set.id}
                sx={{ "&:last-child td, &:last-child th": { border: 0 } }}
                onClick={(event) => {
                  // The set link navigates by itself, and modified clicks
                  // on it open a new tab, so only clicks elsewhere on the
                  // row navigate here.
                  if ((event.target as Element).closest("a")) return;
                  router.push(`/study/${set.id}`);
                }}
              >
                <TableCell sx={{ padding: "16px 0 16px 10px" }}>
                  <Chip size="small" label={set.gdGrade} />
                </TableCell>
                <TableCell component="th" scope="row">
                  <Link href={`/study/${set.id}`}>{set.id}</Link>
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
