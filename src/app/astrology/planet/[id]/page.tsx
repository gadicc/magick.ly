import data from "@magick-data/data";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { decycle } from "cycle";
import { notFound } from "next/navigation";
import { entityIds, planetPage } from "@/seo/entities";
import { seoMetadata } from "@/seo/metadata";

const planets = data.planet;

// Unknown ids are 404s without rendering, so arbitrary URLs add no cache entries.
export const dynamicParams = false;

export function generateStaticParams() {
  return entityIds("planet");
}

export async function generateMetadata({
  params,
}: PageProps<"/astrology/planet/[id]">) {
  const page = planetPage((await params).id);
  if (!page) notFound();
  return seoMetadata(page.path, page);
}

export default async function Planet({
  params,
}: PageProps<"/astrology/planet/[id]">) {
  const { id } = await params;
  if (!planetPage(id)) notFound();
  const planet = planets[id as keyof typeof planets];

  return (
    <Container maxWidth="sm">
      <Box sx={{ my: 4 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          {planet.name.en.en} {planet.symbol}
        </Typography>

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
