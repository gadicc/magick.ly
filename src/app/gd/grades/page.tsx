import Box from "@mui/material/Box";

import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";

import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Data from "@/../data/data";
import GradeTree from "@/components/gd/GradeTree";
import Link from "@/lib/link";

export default function Grades() {
  return (
    <Container maxWidth="sm">
      <Box my={4}>
        <GradeTree />

        <TableContainer component={Paper}>
          <Table aria-label="simple table">
            <TableHead>
              <TableRow>
                <TableCell>Grade</TableCell>
                <TableCell>Name</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {Object.values(Data.gdGrade).map((grade) => (
                <TableRow key={grade.id}>
                  <TableCell scope="row">
                    <Link href={"/gd/grade/" + grade.id}>{grade.id}</Link>
                  </TableCell>

                  <TableCell scope="row">
                    <Link href={"/gd/grade/" + grade.id}>{grade.name}</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Container>
  );
}
