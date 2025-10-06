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
import {
  useGongoIsPopulated,
  useGongoOne,
  useGongoSub,
} from "gongo-client-react";
import React from "react";

export default function StudyInfo(props: { params: Promise<{ _id: string }> }) {
  const params = React.use(props.params);
  const { _id } = params;
  const isPopulated = useGongoIsPopulated();

  const studyData = useGongoOne((db) =>
    db.collection("studySet").find({ setId: _id }),
  );
  useGongoSub("studySet");

  console.log({ studyData });

  if (!isPopulated) return <div>Initializing...</div>;
  if (!studyData) return <div>Loading...</div>;

  return (
    <Container sx={{ p: 2 }}>
      <Typography variant="h4">{studyData.setId}</Typography>
      <br />
      <Typography variant="h6">Stats</Typography>
      <TableContainer component={Paper} sx={{ width: "200px" }}>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Total time:</TableCell>
              <TableCell>{formatDistance(0, studyData.time)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Correct:</TableCell>
              <TableCell>{studyData.correct}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Incorrect:</TableCell>
              <TableCell>{studyData.incorrect}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Grade:</TableCell>
              <TableCell>
                {Math.round(
                  (studyData.correct /
                    (studyData.correct + studyData.incorrect)) *
                    100,
                ) + "%"}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
}
