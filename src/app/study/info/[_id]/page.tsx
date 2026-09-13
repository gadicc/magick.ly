"use client";

import {
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from "@mui/material";
import { formatDistance } from "date-fns";
import React from "react";
import { useSession } from "@/auth/client";
import { useStudySet } from "@/study/client";
import getSet from "@/study/sets";

export default function StudyInfo(props: { params: Promise<{ _id: string }> }) {
  const { _id } = React.use(props.params);
  const session = useSession();
  const accountId = session.isPending
    ? undefined
    : (session.data?.user.id ?? null);
  const set = React.useMemo(() => {
    try {
      return getSet(_id);
    } catch {
      return null;
    }
  }, [_id]);
  const cardIds = React.useMemo(
    () => (set ? Object.keys(set.data) : []),
    [set],
  );
  const runtime = useStudySet(accountId, _id, cardIds);

  if (!set) return <div>Unknown study set.</div>;
  if (runtime.error && !runtime.snapshot)
    return <div>Study progress could not be loaded: {runtime.error}</div>;
  if (runtime.loading || !runtime.snapshot) return <div>Loading progress…</div>;
  const attempts = runtime.snapshot.correct + runtime.snapshot.incorrect;
  return (
    <Container sx={{ p: 2 }}>
      <Typography variant="h4">{runtime.snapshot.setId}</Typography>
      {runtime.error && (
        <Typography color="warning.main">
          Showing progress saved on this device; sync will retry.
        </Typography>
      )}
      <br />
      <Typography variant="h6">Stats</Typography>
      <TableContainer component={Paper} sx={{ width: "220px" }}>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Total time:</TableCell>
              <TableCell>{formatDistance(0, runtime.snapshot.time)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Correct:</TableCell>
              <TableCell>{runtime.snapshot.correct}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Incorrect:</TableCell>
              <TableCell>{runtime.snapshot.incorrect}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Grade:</TableCell>
              <TableCell>
                {attempts
                  ? `${Math.round((runtime.snapshot.correct / attempts) * 100)}%`
                  : "No reviews yet"}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
}
