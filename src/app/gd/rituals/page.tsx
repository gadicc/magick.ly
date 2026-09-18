import { Edit } from "@mui/icons-material";
import {
  Box,
  Chip,
  Container,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import { connection } from "next/server";
import { sqlRitualReader } from "@/doc/sqlRuntime";
import Link from "@/lib/link";
import { pageMetadata } from "@/seo/metadata";
import SqlDocAdmin from "./SqlDocAdmin";

export const metadata = pageMetadata("/gd/rituals");

const builtInDocs = [
  {
    id: "neophyte",
    title: "0=0 Grade of the Neophyte (Regardie, S.M.)",
    canEdit: false,
    templeSlug: null,
  },
  {
    id: "zelator",
    title: "1=10 Grade of the Zelator (Regardie, S.M.)",
    canEdit: false,
    templeSlug: null,
  },
  {
    id: "theoricus",
    title: "2=9 Grade of the Theoricus (Regardie, S.M.)",
    canEdit: false,
    templeSlug: null,
  },
];

export default async function Rituals() {
  // Session and SQL grants are request-scoped; private catalog rows are never prerendered.
  await connection();
  const privateDocs = await sqlRitualReader.listMetadata().catch(() => []);
  const docs = [
    ...builtInDocs,
    ...privateDocs.map((ritual) => ({
      id: ritual.id,
      title: ritual.title,
      canEdit: ritual.canEdit,
      templeSlug: ritual.templeSlug,
    })),
  ];

  return (
    <Container maxWidth="sm">
      <Box>
        <p>
          A collection of public Golden Dawn documents, remodelled for clearer
          visibility on mobile and other devices, with additional helpful
          features. When signed in, this list also includes private rituals you
          are currently authorized to read. See a{" "}
          <a href="https://www.youtube.com/watch?v=iEFiXtxPxu0">short demo</a>.
        </p>
        <TableContainer component={Paper}>
          <Table aria-label="Rituals">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {docs.map((ritual) => (
                <TableRow key={ritual.id}>
                  <TableCell scope="row">
                    <Link href={`/doc/${ritual.id}`}>{ritual.title}</Link>{" "}
                    {ritual.templeSlug && (
                      <Chip
                        label={ritual.templeSlug}
                        size="small"
                        sx={{ mx: 0.5 }}
                      />
                    )}{" "}
                    {ritual.canEdit && (
                      <IconButton
                        size="small"
                        href={`/doc/${ritual.id}/edit`}
                        aria-label={`Edit ${ritual.title}`}
                      >
                        <Edit />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <p>
          <Link href="/offline/ritual">Open downloaded rituals</Link>
        </p>
        <SqlDocAdmin />
        <br />
        <p>
          To share private rituals with temple members, open{" "}
          <Link href="/temples">My Temples</Link>. From there, you can join an
          existing temple or create and manage one.
        </p>
        <p style={{ fontSize: "80%" }}>
          <Link href="/about#credits">Image credits</Link>
        </p>
      </Box>
    </Container>
  );
}
