import React from "react";
import { decycle } from "cycle";

import Container from "@mui/material/Container";
import Box from "@mui/material/Box";

import data from "@magick-data/data";
const planets = data.planet;

export async function generateStaticParams() {
  return Object.keys(planets).map((id) => ({ id }));
}

export default function Planet(props: {
  params: { id: keyof typeof data.planet };
}) {
  const { id } = props.params;
  if (!id) return null;

  const planet = planets[id];
  if (!planet) return null;

  return (
    <Container maxWidth="sm">
      <Box my={4}>
        <p>
          <i>{planet.name.en.en}</i>
        </p>

        <table>
          <tbody>
            {Object.keys(planet).map((key) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{JSON.stringify(decycle(planet[key]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Container>
  );
}
