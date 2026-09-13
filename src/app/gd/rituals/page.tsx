import { Edit } from "@mui/icons-material";
import {
  Box,
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
import SqlDocAdmin from "./SqlDocAdmin";

const builtInDocs = [
  {
    id: "neophyte",
    title: "0=0 Grade of the Neophyte (Regardie, S.M.)",
    canEdit: false,
  },
  {
    id: "zelator",
    title: "1=10 Grade of the Zelator (Regardie, S.M.)",
    canEdit: false,
  },
  {
    id: "theoricus",
    title: "2=9 Grade of the Theoricus (Regardie, S.M.)",
    canEdit: false,
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
    })),
  ];

  return (
    <Container maxWidth="sm">
      <Box>
        <p>
          A collection of well publicized documents, remodelled for clearer
          visibility and various form factors (e.g. mobile), with additional
          helpful features. See a{" "}
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
          Note: You&apos;ll only find material here that is readily available
          elsewhere. However, if you&apos;re the head of an order and want
          private materials made available securely to your members, please
          contact me.
        </p>
        <p>
          Image credit:{" "}
          <a href="https://commons.wikimedia.org/wiki/File:Anxfisa_Golden_Dawn_Robes.jpg">
            Anxfisa Golden Dawn Robes.jpg
          </a>{" "}
          (CC BY-SA 3.0).
        </p>
      </Box>
    </Container>
  );
}
