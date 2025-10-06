"use client";
import React from "react";

import Container from "@mui/material/Container";
import Box from "@mui/material/Box";

import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";

import Link from "@/lib/link";

import MercuryWidget from "@magick-components/astrology/Mercury";
import MoonWidget from "@magick-components/astrology/Moon";
import Tiles from "@/components/Tiles";
import Data from "@/../data/data";
import OpenSource from "@/OpenSource";

const tiles = [
  {
    Component: MoonWidget,
    title: "Moon ☾",
    to: "moon",
  },
  {
    Component: MercuryWidget,
    title: "Mercury ☿",
    to: "planet/mercury",
  },
];

export default function Planets() {

  const navParts = [{ title: "Astrology", url: "/astrology" }];

  return (
    <Container maxWidth="sm">
      <Box my={4}>
        <Tiles tiles={tiles} />

        <TableContainer component={Paper}>
          <Table aria-label="simple table">
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell>English</TableCell>
                <TableCell>Hebrew</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {Object.values(Data.planet).map((planet) => (
                <TableRow key={planet.id}>
                  <TableCell scope="row">
                    <Link href={"/astrology/planet/" + planet.id}>
                      {planet.symbol}
                    </Link>
                  </TableCell>

                  <TableCell scope="row">
                    <Link href={"/astrology/planet/" + planet.id}>
                      {planet.name.en.en}
                    </Link>
                  </TableCell>

                  <TableCell scope="row">
                    <Link href={"/astrology/planet/" + planet.id}>
                      {planet.name.he ? planet.name.he.roman : ""}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <br />
        <OpenSource
          files={[
            "@/app/astrology/planets/page.tsx",
            "@magick-components/astrology/Moon.tsx",
            "@magick-components/astrology/Mercury.tsx",
          ]}
        />

        <div style={{ fontSize: "80%" }}>
          <b>Image credit:</b>
          <a href="https://en.wikipedia.org/wiki/File:Planets2013.svg">
            Planet2013.svg
          </a>{" "}
          from Wikimedia Commons, released under CC-BY-SA 2.5.
        </div>
      </Box>
    </Container>
  );
}
