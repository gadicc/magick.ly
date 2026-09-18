"use client";
import Link from "@magick-components/Link";
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

export default function signs() {
  return (
    <Container maxWidth="sm">
      <Box sx={{ my: 4 }}>
        <TableContainer component={Paper}>
          <Table aria-label="simple table">
            <TableHead>
              <TableRow>
                <TableCell>Sign & Symbol</TableCell>
                <TableCell>Meaning</TableCell>
                <TableCell>Rules from</TableCell>
                <TableCell>Ruled by</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {Object.values(Data.zodiac).map((sign) => (
                // There are no sign pages yet; only the ruling planet links.
                <TableRow key={sign.id}>
                  <TableCell scope="row">
                    {sign.name.en} {sign.symbol}
                  </TableCell>

                  <TableCell scope="row">{sign.meaning.en}</TableCell>

                  <TableCell scope="row">
                    {JSON.stringify(sign.rulesFrom)}
                  </TableCell>

                  <TableCell scope="row">
                    {sign.planet && (
                      <Link href={"/astrology/planet/" + sign.planet.id}>
                        {sign.planet.name.en.en}
                      </Link>
                    )}
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
